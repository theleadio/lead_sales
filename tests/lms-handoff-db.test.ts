// CRM → LMS: the watcher (lib/lms/watch.ts) and the sender (lib/lms/drain.ts)
// against a database with the CRM schema and lead_sales' sales schema. The
// LMS is faked. Each test is rolled back.
import { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { drainLms } from "../lib/lms/drain.ts";
import type { LmsMessage, LmsSender } from "../lib/lms/send.ts";
import {
  watchClasses,
  watchEnrolments,
  watchPeople,
} from "../lib/lms/watch.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse, newUser } from "./seed.ts";

after(closeDb);

const was = process.env.LMS_HANDOFF_ENABLED;
beforeEach(() => {
  process.env.LMS_HANDOFF_ENABLED = "true";
});
afterEach(() => {
  if (was === undefined) delete process.env.LMS_HANDOFF_ENABLED;
  else process.env.LMS_HANDOFF_ENABLED = was;
});

function fakeLms(fail = false) {
  const sent: LmsMessage[] = [];
  const send: LmsSender = async (m) => {
    if (fail) throw new Error(`LMS answered 503 to ${m.type}`);
    sent.push(m);
    return { status: 200, body: {} };
  };
  return { sent, send };
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
  const classId = await newClass({ courseId: await newCourse() });
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

it("a confirmed enrolment is watched, queued once and sent with person, class and course", async () => {
  await fresh();
  const s = await student();
  assert.equal(await watchEnrolments(), 1);
  assert.equal(
    await watchEnrolments(),
    0,
    "re-reading the overlap queues nothing new",
  );

  const lms = fakeLms();
  const r = await drainLms(lms.send);
  assert.equal(r.sent, 1);
  const m = lms.sent[0];
  assert.equal(m.type, "enrolment.confirmed");
  const d = m.data as Record<string, Record<string, unknown>>;
  assert.equal(d.enrolment.id, s.enrolmentId);
  assert.equal(d.class.id, s.classId);
  assert.ok(d.course.name);
  const [n] = await db()`SELECT id, sent_at FROM sales.lms_notice`;
  assert.equal(m.messageId, n.id);
  assert.ok(n.sent_at);
  // The LMS now knows this person and class.
  assert.equal(
    (
      await db()`SELECT 1 FROM sales.lms_person_sent WHERE person_id = ${s.personId}`
    ).length,
    1,
  );
  assert.equal(
    (
      await db()`SELECT 1 FROM sales.lms_class_sent WHERE class_id = ${s.classId}`
    ).length,
    1,
  );
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

it("a class change the LMS holds is sent once; a status-only change is not", async () => {
  await fresh();
  const s = await student();
  await watchEnrolments();
  await drainLms(fakeLms().send);

  await db()`UPDATE class SET status = 'few_seats' WHERE id = ${s.classId}`;
  assert.equal(await watchClasses(), 0, "status isn't something the LMS holds");

  await db()`UPDATE class SET online_url = 'https://meet.example/new', mode = 'hybrid' WHERE id = ${s.classId}`;
  assert.equal(await watchClasses(), 1);
  assert.equal(await watchClasses(), 0);
  const lms = fakeLms();
  await drainLms(lms.send);
  assert.equal(lms.sent[0].type, "class.updated");
  assert.equal(
    await watchClasses(),
    0,
    "after sending, the new state is what the LMS holds",
  );
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

it("a transfer is sent with the new enrolment and class", async () => {
  await fresh();
  const s = await student();
  const toClass = await newClass({ courseId: await newCourse() });
  const newId = await enrol(toClass, "confirmed", { personId: s.personId });
  await db()`UPDATE enrolment SET status = 'transferred', transferred_to_enrolment_id = ${newId} WHERE id = ${s.enrolmentId}`;
  await watchEnrolments();
  const lms = fakeLms();
  await drainLms(lms.send);
  const m = lms.sent.find((x) => x.type === "enrolment.transferred")!;
  assert.equal(m.data.newEnrolmentId, newId);
  assert.equal((m.data.class as { id: string }).id, toClass);
});
