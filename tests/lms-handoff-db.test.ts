// CRM → LMS: the watcher (lib/lms/watch.ts) and the sender (lib/lms/drain.ts)
// against a database with the CRM schema and lead_sales' sales schema. The
// LMS is faked. Each test is rolled back.
import { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { drainLms } from "../lib/lms/drain.ts";
import type { LmsMessage, LmsSender } from "../lib/lms/send.ts";
import { runWatch, watchEnrolments, watchPeople } from "../lib/lms/watch.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrolmentIdFor } from "../lib/crm/salesprocess-ids.ts";
import { enrol, it, newClass, newCourse, newPerson, newUser } from "./seed.ts";

after(closeDb);

const was = process.env.LMS_HANDOFF_ENABLED;
beforeEach(() => {
  process.env.LMS_HANDOFF_ENABLED = "true";
});
afterEach(() => {
  if (was === undefined) delete process.env.LMS_HANDOFF_ENABLED;
  else process.env.LMS_HANDOFF_ENABLED = was;
});

// `reply` is the LMS's answer body for each message (JM: the seat id).
function fakeLms(
  fail = false,
  reply: (m: LmsMessage) => Record<string, unknown> = () => ({}),
) {
  const sent: LmsMessage[] = [];
  const send: LmsSender = async (m) => {
    if (fail) throw new Error(`LMS answered 503 to ${m.type}`);
    sent.push(m);
    return { status: 200, body: reply(m) };
  };
  return { sent, send };
}

const lmsIdOf = async (table: "class" | "enrolment", id: string) => {
  const [r] =
    table === "class"
      ? await db()`SELECT lms_cohort_id AS v FROM class WHERE id = ${id}`
      : await db()`SELECT lms_enrollment_id AS v FROM enrolment WHERE id = ${id}`;
  return (r.v as string | null) ?? null;
};

// A class the LMS has (lead_crm 029); `inLms: false` for one only the CRM has.
async function lmsClass(inLms = true) {
  const classId = await newClass({ courseId: await newCourse() });
  if (inLms)
    await db()`UPDATE class SET lms_cohort_id = gen_random_uuid() WHERE id = ${classId}`;
  return classId;
}

// Each test starts from an empty queue and a cursor an hour back, so it
// sees only the changes it makes.
async function fresh() {
  const sql = db();
  await sql`DELETE FROM sales.lms_notice`;
  await sql`DELETE FROM sales.lms_person_sent`;
  await sql`DELETE FROM sales.lms_class_sent`;
  await sql`DELETE FROM sales.lms_cursor`;
  await sql`
    INSERT INTO sales.lms_cursor (name, read_until)
    VALUES ('enrolment_status', now() - interval '1 hour')`;
}

async function student(
  status = "confirmed",
  email: string | null | undefined = undefined,
) {
  const classId = await lmsClass();
  const enrolmentId = await enrol(classId, status);
  const [{ person_id }] = await db()`
    SELECT person_id FROM enrolment WHERE id = ${enrolmentId}`;
  const mail =
    email === undefined
      ? `s-${crypto.randomUUID().slice(0, 8)}@lead.test`
      : email;
  await db()`UPDATE person SET email = ${mail} WHERE id = ${person_id}`;
  return { classId, enrolmentId, personId: person_id as string };
}

it("a confirmed enrolment is watched, queued once and sent with the LMS class id; the reply's seat id is kept", async () => {
  await fresh();
  const s = await student();
  assert.equal(await watchEnrolments(), 1);
  assert.equal(
    await watchEnrolments(),
    0,
    "re-reading the overlap queues nothing new",
  );

  const seatId = crypto.randomUUID();
  const lms = fakeLms(false, () => ({ seatId }));
  const r = await drainLms(lms.send);
  assert.equal(r.sent, 1);
  const m = lms.sent[0];
  assert.equal(m.type, "enrolment.confirmed");
  const d = m.data as Record<string, Record<string, unknown>>;
  assert.equal(d.enrolment.id, s.enrolmentId);
  assert.equal(d.class.id, await lmsIdOf("class", s.classId), "the LMS's id");
  assert.notEqual(d.class.id, s.classId);
  assert.equal(d.course, undefined, "the LMS owns course details");
  assert.equal(d.enrolment.pricePaidMyr, undefined, "JM doesn't use the price");
  const [n] = await db()`SELECT id, sent_at FROM sales.lms_notice`;
  assert.equal(m.messageId, n.id);
  assert.ok(n.sent_at);
  assert.equal(await lmsIdOf("enrolment", s.enrolmentId), seatId);
  // The LMS now knows this person.
  assert.equal(
    (
      await db()`SELECT 1 FROM sales.lms_person_sent WHERE person_id = ${s.personId}`
    ).length,
    1,
  );
});

it("a reply without a usable seat id saves nothing and the send still counts", async () => {
  await fresh();
  const s = await student();
  await watchEnrolments();
  const r = await drainLms(
    fakeLms(false, () => ({ seatId: "not-a-uuid" })).send,
  );
  assert.equal(r.sent, 1);
  assert.equal(await lmsIdOf("enrolment", s.enrolmentId), null);
});

it("a class not in the LMS yet: the enrol waits without using a try, one Ops task per class, sent once the class is linked", async () => {
  await fresh();
  await newUser("super_admin");
  const classId = await lmsClass(false);
  const a = await enrol(classId, "confirmed");
  const b = await enrol(classId, "confirmed");
  for (const id of [a, b])
    await db()`
      UPDATE person SET email = ${`h-${id.slice(0, 8)}@lead.test`}
      WHERE id = (SELECT person_id FROM enrolment WHERE id = ${id})`;
  await watchEnrolments();
  const lms = fakeLms();
  const r = await drainLms(lms.send);
  assert.equal(r.held, 2);
  assert.equal(lms.sent.length, 0);
  const rows =
    await db()`SELECT attempts, sent_at, dead_at FROM sales.lms_notice`;
  assert.ok(rows.every((n) => n.attempts === 0 && !n.sent_at && !n.dead_at));
  const tasks = await db()`
    SELECT title FROM task WHERE source_key = ${`lms:class:${classId}:not-in-lms`}`;
  assert.equal(tasks.length, 1, "one task for the class, not one per student");
  assert.match(tasks[0].title, /in the LMS/);

  // Ops create it in the LMS; the CRM's sync links it.
  await db()`UPDATE class SET lms_cohort_id = gen_random_uuid() WHERE id = ${classId}`;
  await db()`UPDATE sales.lms_notice SET next_attempt_at = now()`;
  assert.equal((await drainLms(lms.send)).sent, 2);
});

it("fundingType is the seat's own value; a seat with none is null, whatever its deal says", async () => {
  await fresh();
  const seat = await student();
  await db()`UPDATE enrolment SET funding_type = 'leaders_club' WHERE id = ${seat.enrolmentId}`;
  const viaDeal = await student();
  const [deal] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, funding_type)
    VALUES ('individual', 'new', ${viaDeal.personId}, 'hrdc') RETURNING id`;
  await db()`UPDATE enrolment SET deal_id = ${deal.id} WHERE id = ${viaDeal.enrolmentId}`;
  const none = await student();
  assert.equal(await watchEnrolments(), 3);
  const lms = fakeLms();
  await drainLms(lms.send);
  const funding = Object.fromEntries(
    lms.sent.map((m) => {
      const d = m.data as Record<string, Record<string, unknown>>;
      return [d.enrolment.id as string, d.enrolment.fundingType];
    }),
  );
  assert.deepEqual(funding, {
    [seat.enrolmentId]: "leaders_club",
    [viaDeal.enrolmentId]: null,
    [none.enrolmentId]: null,
  });
});

it("the first run starts from now: older changes go through the backfill", async () => {
  await fresh();
  await db()`DELETE FROM sales.lms_cursor`;
  await student();
  assert.equal(await watchEnrolments(), 0);
  const [c] =
    await db()`SELECT 1 FROM sales.lms_cursor WHERE name = 'enrolment_status'`;
  assert.ok(c);
});

it("with the switch off, nothing is sent", async () => {
  await fresh();
  await student();
  await watchEnrolments();
  process.env.LMS_HANDOFF_ENABLED = "";
  const lms = fakeLms();
  assert.deepEqual(await drainLms(lms.send), {
    sent: 0,
    skipped: 0,
    held: 0,
    failed: 0,
    dead: 0,
  });
});

it("a cancel is sent only for a student who was ever confirmed", async () => {
  await fresh();
  const was = await student("confirmed");
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'student_withdrew' WHERE id = ${was.enrolmentId}`;
  const never = await student("reserved");
  await db()`UPDATE enrolment SET status = 'cancelled' WHERE id = ${never.enrolmentId}`;
  await watchEnrolments();
  const kinds =
    await db()`SELECT kind, ref_id, extra FROM sales.lms_notice ORDER BY created_at, kind`;
  const cancels = kinds.filter((k) => k.kind === "enrolment.cancelled");
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].ref_id, was.enrolmentId);
  assert.equal(cancels[0].extra.reason, "student_withdrew");
});

it("a held enrol whose seat is cancelled before the class reaches the LMS is never sent", async () => {
  await fresh();
  await newUser("super_admin");
  const classId = await lmsClass(false);
  const id = await enrol(classId, "confirmed");
  await db()`
    UPDATE person SET email = ${`c-${id.slice(0, 8)}@lead.test`}
    WHERE id = (SELECT person_id FROM enrolment WHERE id = ${id})`;
  await watchEnrolments();
  const lms = fakeLms();
  assert.equal((await drainLms(lms.send)).held, 1);

  // Cancelled while held: the LMS never had the seat, so its cancel is skipped.
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'refunded' WHERE id = ${id}`;
  await watchEnrolments();
  // Then Ops create the class in the LMS and the sync links it.
  await db()`UPDATE class SET lms_cohort_id = gen_random_uuid() WHERE id = ${classId}`;
  await db()`UPDATE sales.lms_notice SET next_attempt_at = now()`;
  const r = await drainLms(lms.send);
  assert.equal(
    lms.sent.length,
    0,
    "a cancelled student must not get LMS access",
  );
  assert.equal(r.skipped, 2);
  const reasons = await db()`
    SELECT kind, skipped_reason FROM sales.lms_notice ORDER BY kind`;
  assert.deepEqual(
    reasons.map((n) => [n.kind, n.skipped_reason]),
    [
      ["enrolment.cancelled", "no LMS seat id"],
      ["enrolment.confirmed", "seat is cancelled"],
    ],
  );
});

it("a cancel names the LMS seat only; no seat id, or a seat the LMS removed itself, is not sent", async () => {
  await fresh();
  const seatId = crypto.randomUUID();
  const known = await student();
  await db()`UPDATE enrolment SET lms_enrollment_id = ${seatId} WHERE id = ${known.enrolmentId}`;
  const unknown = await student();
  const gone = await student();
  await db()`UPDATE enrolment SET lms_enrollment_id = gen_random_uuid() WHERE id = ${gone.enrolmentId}`;
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'student_withdrew' WHERE id IN (${known.enrolmentId}, ${unknown.enrolmentId})`;
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'Removed from the LMS' WHERE id = ${gone.enrolmentId}`;
  await watchEnrolments();
  await db()`DELETE FROM sales.lms_notice WHERE kind <> 'enrolment.cancelled'`;
  const lms = fakeLms();
  const r = await drainLms(lms.send);
  assert.equal(r.sent, 1);
  assert.equal(r.skipped, 2);
  assert.equal(lms.sent[0].type, "enrolment.cancelled");
  assert.deepEqual(lms.sent[0].data, { seatId });
  const skipped = await db()`
    SELECT ref_id, skipped_reason FROM sales.lms_notice WHERE skipped_reason IS NOT NULL`;
  assert.deepEqual(
    Object.fromEntries(skipped.map((n) => [n.ref_id, n.skipped_reason])),
    {
      [unknown.enrolmentId]: "no LMS seat id",
      [gone.enrolmentId]: "already removed in the LMS",
    },
  );
});

it("a cancel the LMS answers with removed: false gives Ops a task to check by hand", async () => {
  await fresh();
  await newUser("super_admin");
  const s = await student();
  await db()`UPDATE enrolment SET lms_enrollment_id = gen_random_uuid() WHERE id = ${s.enrolmentId}`;
  await watchEnrolments();
  await db()`UPDATE sales.lms_notice SET sent_at = now()`;
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'student_withdrew' WHERE id = ${s.enrolmentId}`;
  await watchEnrolments();
  const r = await drainLms(fakeLms(false, () => ({ removed: false })).send);
  assert.equal(r.sent, 1, "not retried: retrying won't help");
  const [n] = await db()`
    SELECT last_error FROM sales.lms_notice WHERE kind = 'enrolment.cancelled'`;
  assert.equal(n.last_error, "LMS removed nothing");
  const [t] = await db()`
    SELECT title FROM task WHERE enrolment_id = ${s.enrolmentId}`;
  assert.match(t.title, /removed from the LMS/);
});

it("a seat the SalesProcess import made is not sent as confirmed, but its cancel is", async () => {
  await fresh();
  const orderId = `order-${crypto.randomUUID()}`;
  const id = enrolmentIdFor(orderId);
  const classId = await lmsClass();
  const personId = await newPerson("Imported Student");
  await db()`UPDATE person SET email = ${`i-${id.slice(0, 8)}@lead.test`} WHERE id = ${personId}`;
  await db()`
    INSERT INTO salesprocess_payment (id, order_id, ghl_contact_id, status, amount_myr, currency, live_mode, paid_at)
    VALUES (${`txn-${orderId}`}, ${orderId}, 'ghl-contact', 'succeeded', 3200, 'MYR', false, now())`;
  await db()`
    INSERT INTO enrolment (id, person_id, class_id, status, payer_type, price_paid_myr)
    VALUES (${id}, ${personId}, ${classId}, 'confirmed', 'self', 3200)`;
  const normal = await student();

  await watchEnrolments();
  const confirmed = await db()`
    SELECT ref_id FROM sales.lms_notice WHERE kind = 'enrolment.confirmed'`;
  assert.deepEqual(
    confirmed.map((r) => r.ref_id),
    [normal.enrolmentId],
    "GHL already onboarded the imported student",
  );

  // Adopted by the LMS sync, the student is in the LMS: a cancel still goes out.
  await db()`UPDATE enrolment SET status = 'cancelled', cancelled_reason = 'Not in the LMS at class start' WHERE id = ${id}`;
  await watchEnrolments();
  const cancels = await db()`
    SELECT ref_id FROM sales.lms_notice WHERE kind = 'enrolment.cancelled'`;
  assert.deepEqual(
    cancels.map((r) => r.ref_id),
    [id],
  );
});

it("no email: skipped with an Ops task; adding the email sends the student", async () => {
  await fresh();
  await newUser("super_admin");
  const s = await student("confirmed", null);
  await watchEnrolments();
  const lms = fakeLms();
  assert.equal((await drainLms(lms.send)).skipped, 1);
  const [t] =
    await db()`SELECT title FROM task WHERE enrolment_id = ${s.enrolmentId}`;
  assert.match(t.title, /Add an email/);

  await db()`UPDATE person SET email = 'late@lead.test' WHERE id = ${s.personId}`;
  assert.equal(await watchPeople(), 1);
  await drainLms(lms.send);
  assert.equal(lms.sent.length, 1);
  assert.equal(
    (lms.sent[0].data.person as { email: string }).email,
    "late@lead.test",
  );
});

it("an LMS failure retries with backoff, then goes dead after 5 tries", async () => {
  await fresh();
  await student();
  await watchEnrolments();
  const down = fakeLms(true);
  assert.equal((await drainLms(down.send)).failed, 1);
  let [n] =
    await db()`SELECT attempts, last_error, next_attempt_at > now() AS later FROM sales.lms_notice`;
  assert.equal(n.attempts, 1);
  assert.match(n.last_error, /503/);
  assert.equal(n.later, true);

  for (let i = 0; i < 4; i++) {
    await db()`UPDATE sales.lms_notice SET next_attempt_at = now()`;
    await drainLms(down.send);
  }
  [n] = await db()`SELECT attempts, dead_at FROM sales.lms_notice`;
  assert.equal(n.attempts, 5);
  assert.ok(n.dead_at);
});

it("class edits are not sent: the LMS owns classes", async () => {
  await fresh();
  const s = await student();
  await watchEnrolments();
  await drainLms(fakeLms().send);
  await db()`UPDATE class SET online_url = 'https://meet.example/new', mode = 'hybrid' WHERE id = ${s.classId}`;
  assert.deepEqual(await runWatch(), { enrolments: 0, people: 0 });
  // A class.updated queued before this change is dropped, not sent.
  await db()`
    INSERT INTO sales.lms_notice (kind, ref_id, extra, source_key)
    VALUES ('class.updated', ${s.classId}, '{}', ${`old:${s.classId}`})`;
  const lms = fakeLms();
  assert.equal((await drainLms(lms.send)).skipped, 1);
  assert.equal(lms.sent.length, 0);
});

it("an email change is sent as person.updated with the old email", async () => {
  await fresh();
  const s = await student("confirmed", "old@lead.test");
  await watchEnrolments();
  await drainLms(fakeLms().send);

  await db()`UPDATE person SET email = 'new@lead.test' WHERE id = ${s.personId}`;
  assert.equal(await watchPeople(), 1);
  const lms = fakeLms();
  await drainLms(lms.send);
  const m = lms.sent.find((x) => x.type === "person.updated")!;
  assert.equal(m.data.previousEmail, "old@lead.test");
  assert.equal(m.data.email, "new@lead.test");
  assert.equal(await watchPeople(), 0);
});

// The CRM's move: the old seat becomes transferred and points at a new,
// confirmed seat in the other class (lead_crm transferEnrolment).
async function move(
  s: { enrolmentId: string; personId: string },
  toClass: string,
) {
  const newId = await enrol(toClass, "confirmed", { personId: s.personId });
  await db()`UPDATE enrolment SET status = 'transferred', transferred_to_enrolment_id = ${newId} WHERE id = ${s.enrolmentId}`;
  return newId;
}

it("a move is one enrolment.transferred with the LMS seat and class ids; no extra confirm for the new seat", async () => {
  await fresh();
  const s = await student();
  const oldSeat = crypto.randomUUID();
  await db()`UPDATE enrolment SET lms_enrollment_id = ${oldSeat} WHERE id = ${s.enrolmentId}`;
  const toClass = await lmsClass();
  await watchEnrolments();
  await db()`UPDATE sales.lms_notice SET sent_at = now()`;
  const newId = await move(s, toClass);
  await watchEnrolments();
  const kinds =
    await db()`SELECT kind FROM sales.lms_notice WHERE sent_at IS NULL`;
  assert.deepEqual(
    kinds.map((k) => k.kind),
    ["enrolment.transferred"],
    "a confirm too would put the student in the new class twice",
  );

  const newSeat = crypto.randomUUID();
  const lms = fakeLms(false, () => ({ seatId: newSeat }));
  await drainLms(lms.send);
  assert.equal(lms.sent.length, 1);
  assert.deepEqual(lms.sent[0].data, {
    seatId: oldSeat,
    toClassId: await lmsIdOf("class", toClass),
  });
  assert.equal(
    await lmsIdOf("enrolment", newId),
    newSeat,
    "the reply's new id",
  );
  assert.equal(await lmsIdOf("enrolment", s.enrolmentId), null);
});

it("a move whose reply has no new seat id keeps the old id on the new seat", async () => {
  await fresh();
  const s = await student();
  const oldSeat = crypto.randomUUID();
  await db()`UPDATE enrolment SET lms_enrollment_id = ${oldSeat} WHERE id = ${s.enrolmentId}`;
  await watchEnrolments();
  await db()`UPDATE sales.lms_notice SET sent_at = now()`;
  const newId = await move(s, await lmsClass());
  await watchEnrolments();
  await drainLms(fakeLms().send);
  assert.equal(await lmsIdOf("enrolment", newId), oldSeat);
  assert.equal(await lmsIdOf("enrolment", s.enrolmentId), null);
});

it("a move of a seat the LMS never had is sent as an enrol of the new seat", async () => {
  await fresh();
  const s = await student();
  const toClass = await lmsClass();
  await watchEnrolments();
  await db()`UPDATE sales.lms_notice SET sent_at = now()`;
  const newId = await move(s, toClass);
  await watchEnrolments();
  const seatId = crypto.randomUUID();
  const lms = fakeLms(false, () => ({ seatId }));
  await drainLms(lms.send);
  assert.equal(lms.sent.length, 1);
  assert.equal(lms.sent[0].type, "enrolment.confirmed");
  const d = lms.sent[0].data as Record<string, Record<string, unknown>>;
  assert.equal(d.enrolment.id, newId);
  assert.equal(d.class.id, await lmsIdOf("class", toClass));
  assert.equal(await lmsIdOf("enrolment", newId), seatId);
});

it("a move to a class not in the LMS waits, like an enrol", async () => {
  await fresh();
  await newUser("super_admin");
  const s = await student();
  await db()`UPDATE enrolment SET lms_enrollment_id = gen_random_uuid() WHERE id = ${s.enrolmentId}`;
  await watchEnrolments();
  await db()`UPDATE sales.lms_notice SET sent_at = now()`;
  await move(s, await lmsClass(false));
  await watchEnrolments();
  const lms = fakeLms();
  assert.equal((await drainLms(lms.send)).held, 1);
  assert.equal(lms.sent.length, 0);
});

it("a change in the same millisecond as the watcher's read is not lost (microsecond bound)", async () => {
  await fresh();
  // Many students right before the read: some history rows land in the same
  // millisecond as the watcher's clock. Every one must be queued in this run.
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) ids.push((await student()).enrolmentId);
  assert.equal(await watchEnrolments(), 20);
  const queued = await db()`SELECT ref_id FROM sales.lms_notice`;
  assert.deepEqual(queued.map((r) => r.ref_id).sort(), [...ids].sort());
});
