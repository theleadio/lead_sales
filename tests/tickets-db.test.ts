// Tickets (lib/tickets/service.ts): routing to a team, round robin, the
// deadline, status moves, who may see what, and follow-up tickets. Each
// test is rolled back.
import { after } from "node:test";
import assert from "node:assert/strict";
import {
  addNote,
  assignTicket,
  canMove,
  changeCategory,
  createTicket,
  followUpTicket,
  listTickets,
  markFirstResponse,
  setStatus,
  suggestCategory,
  TicketError,
} from "../lib/tickets/service.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

const none = new Set<string>();

async function teamId(code: string): Promise<string> {
  const [t] = await db()`SELECT id FROM sales.team WHERE code = ${code}`;
  return t.id as string;
}

async function member(
  code: string,
  role: Parameters<typeof newUser>[0] = "support",
) {
  const u = await newUser(role);
  await db()`
    INSERT INTO sales.team_member (team_id, user_id)
    VALUES (${await teamId(code)}, ${u.id})`;
  return u;
}

// Each test starts with empty teams and no rules, so it sees only its own.
async function fresh() {
  await db()`DELETE FROM sales.ticket_rule`;
  await db()`DELETE FROM sales.team_member`;
}

const ticket = async (
  category: string,
  actor: Awaited<ReturnType<typeof newUser>> | null,
  over: Partial<Parameters<typeof createTicket>[0]> = {},
) =>
  createTicket(
    {
      personId: await newPerson("Ticket Customer"),
      sourceChannel: "manual",
      category,
      subject: "Need my e-invoice",
      receivedAt: new Date("2026-11-03T10:00:00+08:00"),
      ...over,
    },
    actor,
    none,
  );

it("a category routes to its team, round robin, with the next-working-day deadline", async () => {
  await fresh();
  const a = await member("finance");
  const b = await member("finance");
  const agent = await newUser("support");
  const t1 = await ticket("einvoice", agent);
  const t2 = await ticket("receipt", agent);
  const t3 = await ticket("einvoice", agent);
  assert.equal(t1.team_id, await teamId("finance"));
  assert.match(t1.number, /^T-\d{6}$/);
  assert.notEqual(t1.number, t2.number);
  // Round robin: two different people, then back to the first.
  assert.deepEqual(
    new Set([t1.assigned_user_id, t2.assigned_user_id]),
    new Set([a.id, b.id]),
  );
  assert.equal(t3.assigned_user_id, t1.assigned_user_id);
  assert.deepEqual(t1.sla_due_at, new Date("2026-11-04T10:00:00+08:00"));
  assert.equal(t1.status, "new");
  const [e] = await db()`
    SELECT kind, after FROM sales.ticket_event WHERE ticket_id = ${t1.id}`;
  assert.equal(e.kind, "created");
  const [audit] = await db()`
    SELECT action FROM audit_log WHERE entity = 'ticket' AND entity_id = ${t1.id}`;
  assert.equal(audit.action, "create");
});

it("an inactive member is skipped; a team with no one leaves the ticket unassigned", async () => {
  await fresh();
  const gone = await member("tech");
  await db()`UPDATE app_user SET is_active = false WHERE id = ${gone.id}`;
  const t = await ticket("voucher", null);
  assert.equal(t.team_id, await teamId("tech"));
  assert.equal(t.assigned_user_id, null);
});

it("the first matching rule wins: team and fixed assignee", async () => {
  await fresh();
  const qiEn = await member("operations", "operations");
  await db()`
    INSERT INTO sales.ticket_rule (position, match_channel, set_team_id, assign_mode, assign_user_id)
    VALUES (1, 'web_form', ${await teamId("operations")}, 'fixed', ${qiEn.id}),
           (2, NULL, NULL, 'none', NULL)`;
  const web = await ticket("general", null, { sourceChannel: "web_form" });
  assert.equal(web.team_id, await teamId("operations"));
  assert.equal(web.assigned_user_id, qiEn.id);
  const other = await ticket("general", null, { sourceChannel: "whatsapp" });
  assert.equal(other.team_id, await teamId("support"));
  assert.equal(other.assigned_user_id, null, "rule 2: assign none");
});

it("keywords suggest a category; nothing matches → null", async () => {
  assert.equal(
    await suggestCategory("Hi, can I get the E-Invoice please"),
    "einvoice",
  );
  assert.equal(await suggestCategory("my voucher code fails"), "voucher");
  assert.equal(await suggestCategory("我需要收据"), "receipt");
  assert.equal(await suggestCategory("what time is class?"), null);
});

it("status moves follow the rules; closed is final", async () => {
  await fresh();
  const a = await member("support");
  const t = await ticket("general", a);
  await setStatus(t.id, "resolved", a);
  let [r] =
    await db()`SELECT status, resolved_at FROM sales.ticket WHERE id = ${t.id}`;
  assert.equal(r.status, "resolved");
  assert.ok(r.resolved_at);
  await setStatus(t.id, "open", a);
  [r] =
    await db()`SELECT status, resolved_at FROM sales.ticket WHERE id = ${t.id}`;
  assert.equal(r.resolved_at, null, "reopened");
  await setStatus(t.id, "closed", a);
  await assert.rejects(
    setStatus(t.id, "open", a),
    /closed ticket can't become open/,
  );
  assert.equal(canMove("closed", "resolved"), false);
});

it("first response stops the clock once and opens a new ticket", async () => {
  await fresh();
  const a = await member("support");
  const t = await ticket("general", a);
  await markFirstResponse(t.id, a);
  const [r1] =
    await db()`SELECT status, first_response_at FROM sales.ticket WHERE id = ${t.id}`;
  assert.equal(r1.status, "open");
  await markFirstResponse(t.id, a);
  const [r2] =
    await db()`SELECT first_response_at FROM sales.ticket WHERE id = ${t.id}`;
  assert.deepEqual(r2.first_response_at, r1.first_response_at);
});

it("Finance tickets: only Finance, super_admin and management see them", async () => {
  await fresh();
  const fin = await member("finance");
  const agent = await newUser("support");
  const boss = await newUser("management");
  const t = await ticket("einvoice", agent);

  const ids = async (
    u: { id: string; role: never },
    scope: "all" | "teams" | "mine",
  ) => (await listTickets(u, { scope })).map((x) => x.id);
  assert.ok((await ids(fin as never, "teams")).includes(t.id));
  assert.ok((await ids(boss as never, "all")).includes(t.id));
  assert.ok(
    !(await ids(agent as never, "all")).includes(t.id),
    "the agent who made it can't see a restricted team's ticket",
  );

  await assert.rejects(addNote(t.id, "peek", agent), (e) => {
    assert.ok(e instanceof TicketError);
    assert.equal(e.code, "not_found");
    return true;
  });
  const [denied] = await db()`
    SELECT 1 FROM audit_log
    WHERE action = 'permission_denied' AND entity = 'ticket' AND entity_id = ${t.id}`;
  assert.ok(denied, "the refusal is audited (kept after the rollback)");

  // A non-restricted team's ticket stays visible to its creator.
  const tech = await ticket("voucher", agent);
  assert.ok((await ids(agent as never, "all")).includes(tech.id));
});

it("changing category moves team and reassigns when needed", async () => {
  await fresh();
  const sup = await member("support");
  const tech = await member("tech");
  const t = await ticket("general", sup);
  assert.equal(t.assigned_user_id, sup.id);
  await changeCategory(t.id, "api_key", sup);
  const [r] =
    await db()`SELECT team_id, assigned_user_id, category FROM sales.ticket WHERE id = ${t.id}`;
  assert.equal(r.category, "api_key");
  assert.equal(r.team_id, await teamId("tech"));
  assert.equal(r.assigned_user_id, tech.id);
  await assert.rejects(assignTicket(t.id, sup.id, tech), /active member/);
});

it("a reply after resolve: the old ticket closes, a new one links to it", async () => {
  await fresh();
  const a = await member("support");
  const t = await ticket("general", a);
  await setStatus(t.id, "resolved", a);
  const next = await followUpTicket(
    t.id,
    new Date("2026-11-06T17:00:00+08:00"),
    none,
  );
  const [old] = await db()`SELECT status FROM sales.ticket WHERE id = ${t.id}`;
  assert.equal(old.status, "closed");
  const [n] = await db()`
    SELECT previous_ticket_id, subject, sla_due_at FROM sales.ticket WHERE id = ${next.id}`;
  assert.equal(n.previous_ticket_id, t.id);
  assert.match(n.subject, /^Re: /);
  assert.deepEqual(n.sla_due_at, new Date("2026-11-10T08:30:00+08:00"));
  await assert.rejects(followUpTicket(next.id, new Date(), none), /still open/);
});

it("overdue: no first reply past the deadline", async () => {
  await fresh();
  const a = await member("support");
  const late = await ticket("general", a, {
    receivedAt: new Date("2026-01-05T10:00:00+08:00"),
  });
  const answered = await ticket("general", a, {
    receivedAt: new Date("2026-01-05T10:00:00+08:00"),
  });
  await markFirstResponse(answered.id, a);
  const overdue = (
    await listTickets(a, { scope: "mine", overdueOnly: true })
  ).map((x) => x.id);
  assert.ok(overdue.includes(late.id));
  assert.ok(!overdue.includes(answered.id));
});

it("ticket history is append-only", async () => {
  await fresh();
  const a = await member("support");
  const t = await ticket("general", a);
  await assert.rejects(
    db()`UPDATE sales.ticket_event SET note = 'x' WHERE ticket_id = ${t.id}`,
    /append-only/,
  );
});
