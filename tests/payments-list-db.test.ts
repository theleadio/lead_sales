// The Payments screen's read (lib/payments/list.ts) against the database: who
// sees which payments (CRM spec §6), the three views, search, paging, the
// month tiles, and that every payment shown is audit-logged. Each test is
// rolled back (`it` in ./seed.ts). Totals are compared before and after, so
// rows already in a shared staging database don't matter.
import { after } from "node:test";
import assert from "node:assert/strict";
import {
  listPayments,
  paymentSummary,
  PAGE_SIZE,
} from "../lib/payments/list.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newPerson, newUser, pay } from "./seed.ts";

after(closeDb);

const tag = () => `Payer ${crypto.randomUUID().slice(0, 8)}`;

async function dealFor(personId: string, ownerId: string): Promise<string> {
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, owner_user_id)
    VALUES ('individual', 'new', ${personId}, ${ownerId})
    RETURNING id`;
  return d.id as string;
}

async function unmatched(amount = "320.00"): Promise<string> {
  const [p] = await db()`
    INSERT INTO payment (match_status, method, status, amount_myr, paid_at,
                         stripe_payment_intent_id, stripe_checkout_session_id,
                         notes)
    VALUES ('unmatched', 'stripe_card', 'succeeded', ${amount}, now(),
            ${`pi_${crypto.randomUUID()}`}, ${`cs_${crypto.randomUUID()}`},
            'Unmatched Stripe card payment: test')
    RETURNING id`;
  await db()`
    INSERT INTO task (type, title, payment_id, due_at)
    VALUES ('match_payment', 'Match a test payment', ${p.id}, now())`;
  return p.id as string;
}

it("lists a payment with its person and class, newest first", async () => {
  const ops = await newUser("operations");
  const name = tag();
  const classId = await newClass();
  const older = await pay(await enrol(classId, "confirmed", { name }), {
    amount: "100.00",
  });
  await db()`UPDATE payment SET paid_at = now() - interval '1 day'
             WHERE id = ${older}`;
  const newer = await pay(await enrol(classId, "confirmed", { name }), {
    amount: "200.00",
  });

  const { rows, hasMore } = await listPayments(ops, { view: "all", q: name });
  assert.equal(hasMore, false);
  assert.deepEqual(
    rows.map((r) => r.id),
    [newer, older],
  );
  assert.equal(rows[0].personName, name);
  assert.equal(rows[0].amountMyr, "200.00");
  assert.ok(rows[0].classCode?.startsWith("C-"));
  assert.equal(rows[0].matched, true);
});

it("unmatched view shows only unmatched payments, with the open task", async () => {
  const admin = await newUser("super_admin");
  const id = await unmatched();
  await pay(await enrol(await newClass(), "confirmed"));

  const { rows } = await listPayments(admin, { view: "unmatched" });
  assert.ok(rows.every((r) => !r.matched));
  const row = rows.find((r) => r.id === id);
  assert.ok(row, "the unmatched payment is listed");
  assert.ok(row.openMatchTaskId);
  assert.equal(row.personName, null);
});

it("refunds view shows only payments with money refunded", async () => {
  const mgmt = await newUser("management");
  const name = tag();
  const classId = await newClass();
  const refunded = await pay(await enrol(classId, "confirmed", { name }));
  await db()`UPDATE payment SET refunded_amount_myr = 500,
               status = 'partially_refunded', refunded_at = now()
             WHERE id = ${refunded}`;
  await pay(await enrol(classId, "confirmed", { name }));

  const { rows } = await listPayments(mgmt, { view: "refunds", q: name });
  assert.deepEqual(
    rows.map((r) => r.id),
    [refunded],
  );
  assert.equal(rows[0].refundedMyr, "500.00");
});

it("sales see payments on their own deals only", async () => {
  const mine = await newUser("sales");
  const theirs = await newUser("sales");
  const name = tag();
  const classId = await newClass();
  const personA = await newPerson(name);
  const personB = await newPerson(name);
  const eA = await enrol(classId, "confirmed", { personId: personA });
  const eB = await enrol(classId, "confirmed", { personId: personB });
  await db()`UPDATE enrolment SET deal_id = ${await dealFor(personA, mine.id)}
             WHERE id = ${eA}`;
  await db()`UPDATE enrolment SET deal_id = ${await dealFor(personB, theirs.id)}
             WHERE id = ${eB}`;
  const pA = await pay(eA);
  await pay(eB);
  await unmatched();

  const { rows } = await listPayments(mine, { view: "all", q: name });
  assert.deepEqual(
    rows.map((r) => r.id),
    [pA],
  );
  const un = await listPayments(mine, { view: "unmatched" });
  assert.equal(un.rows.length, 0, "an unmatched payment has no owner");
});

it("marketing, support and part_time see no payments", async () => {
  await pay(await enrol(await newClass(), "confirmed"));
  for (const role of ["marketing", "support", "part_time"] as const) {
    const u = await newUser(role);
    const { rows } = await listPayments(u, { view: "all" });
    assert.equal(rows.length, 0, role);
    const s = await paymentSummary(u);
    assert.equal(s.unmatchedCount, 0, role);
  }
});

it("search treats % and _ literally", async () => {
  const ops = await newUser("operations");
  const name = tag();
  await pay(await enrol(await newClass(), "confirmed", { name }));
  const { rows } = await listPayments(ops, { view: "all", q: "%" });
  assert.ok(rows.every((r) => r.personName?.includes("%") ?? false));
});

it("pages by PAGE_SIZE and says when more remain", async () => {
  const ops = await newUser("operations");
  // One active enrolment per person and class, so one person each; the
  // class code is what the search finds.
  const classId = await newClass({ capacity: PAGE_SIZE + 5 });
  const [{ code }] = await db()`SELECT code FROM class WHERE id = ${classId}`;
  for (let i = 0; i < PAGE_SIZE + 1; i++)
    await pay(await enrol(classId, "confirmed"));

  const first = await listPayments(ops, { view: "all", q: code, page: 1 });
  assert.equal(first.rows.length, PAGE_SIZE);
  assert.equal(first.hasMore, true);
  const second = await listPayments(ops, { view: "all", q: code, page: 2 });
  assert.equal(second.rows.length, 1);
  assert.equal(second.hasMore, false);
});

it("every payment shown is audit-logged as a view", async () => {
  const ops = await newUser("operations");
  const name = tag();
  const id = await pay(await enrol(await newClass(), "confirmed", { name }));
  await listPayments(ops, { view: "all", q: name });
  const [a] = await db()`
    SELECT count(*)::int AS n FROM audit_log
    WHERE user_id = ${ops.id} AND action = 'view' AND entity = 'payment'
      AND entity_id = ${id}`;
  assert.equal(a.n, 1);
});

it("month tiles add this month's money, refunds and unmatched payments", async () => {
  const admin = await newUser("super_admin");
  const before = await paymentSummary(admin);
  const p = await pay(await enrol(await newClass(), "confirmed"), {
    amount: "1000.00",
  });
  await db()`UPDATE payment SET refunded_amount_myr = 250,
               status = 'partially_refunded', refunded_at = now()
             WHERE id = ${p}`;
  // Last year's payment is not this month's.
  const old = await pay(await enrol(await newClass(), "confirmed"), {
    amount: "999.00",
  });
  await db()`UPDATE payment SET paid_at = now() - interval '400 days'
             WHERE id = ${old}`;
  await unmatched("320.00");
  const after = await paymentSummary(admin);

  const diff = (a: string, b: string) => (Number(a) - Number(b)).toFixed(2);
  assert.equal(
    diff(after.receivedThisMonthMyr, before.receivedThisMonthMyr),
    "1320.00",
  );
  assert.equal(
    diff(after.refundedThisMonthMyr, before.refundedThisMonthMyr),
    "250.00",
  );
  assert.equal(after.unmatchedCount - before.unmatchedCount, 1);
  assert.equal(diff(after.unmatchedMyr, before.unmatchedMyr), "320.00");
});
