// What the ticket screens read (lib/tickets/read.ts): a ticket's detail with
// its history, under the same access rules as changes, and finding the
// customer for a ticket made by hand.
import { after } from "node:test";
import assert from "node:assert/strict";
import { findPersonByContact, ticketDetail } from "../lib/tickets/read.ts";
import { addNote, createTicket } from "../lib/tickets/service.ts";
import { normalizePhoneE164 } from "../lib/crm/phone.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

// phone_e164 is set by the app (lib/crm/phone.ts), not the database.
async function personWith(email: string, phone: string) {
  const [p] = await db()`
    INSERT INTO person (full_name, email, phone, phone_e164)
    VALUES ('Lim Ah Kow', ${email}, ${phone}, ${normalizePhoneE164(phone)})
    RETURNING id`;
  return p.id as string;
}

it("detail: the ticket, its customer and history; hidden from those who can't see it", async () => {
  await db()`DELETE FROM sales.team_member`;
  await db()`DELETE FROM sales.ticket_rule`;
  const [fin] = await db()`SELECT id FROM sales.team WHERE code = 'finance'`;
  const finance = await newUser("operations");
  await db()`INSERT INTO sales.team_member (team_id, user_id) VALUES (${fin.id}, ${finance.id})`;
  const agent = await newUser("support");
  const email = `ahkow-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const personId = await personWith(email, "012-555 0101");
  const t = await createTicket(
    {
      personId,
      sourceChannel: "manual",
      category: "receipt",
      subject: "Receipt for March class",
    },
    agent,
    new Set(),
  );
  await addNote(t.id, "Paid by FPX on 2 Mar.", finance);

  const d = await ticketDetail(finance, t.id);
  assert.ok(d);
  assert.equal(d.number, t.number);
  assert.equal(d.person.email, email);
  assert.equal(d.teamName, "Finance");
  assert.equal(d.assignedUserId, finance.id);
  assert.deepEqual(
    d.events.map((e) => e.kind),
    ["created", "note"],
  );
  assert.equal(d.events[1].note, "Paid by FPX on 2 Mar.");

  assert.equal(await ticketDetail(agent, t.id), null, "Finance is restricted");
  const [denied] = await db()`
    SELECT 1 FROM audit_log
    WHERE action = 'permission_denied' AND entity_id = ${t.id} AND user_id = ${agent.id}`;
  assert.ok(denied);
  assert.equal(await ticketDetail(finance, "not-a-uuid"), null);
});

it("the customer is found by email or phone, the CRM's normalised keys", async () => {
  const email = `Mixed.Case-${crypto.randomUUID().slice(0, 8)}@Example.test`;
  const id = await personWith(email, "+60 12-555 0199");
  const byEmail = await findPersonByContact(`  ${email.toUpperCase()} `);
  assert.deepEqual(
    byEmail.map((p) => p.id),
    [id],
  );
  const byPhone = await findPersonByContact("012-555 0199");
  assert.ok(
    byPhone.some((p) => p.id === id),
    "local and +60 forms match",
  );
  assert.deepEqual(await findPersonByContact("nobody@nowhere.test"), []);
  assert.deepEqual(await findPersonByContact("not a phone"), []);
});
