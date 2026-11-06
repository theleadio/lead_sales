// WhatsApp history import (lib/wati/history.ts): WATI's past chats into the
// inbox for people already in the CRM. The WATI reader is faked; the shapes
// follow what the live API returned on 6 Nov (a conversation has a contact
// id, a contact has wa_id/phone, a message has owner/status/unix timestamp).
// Each DB test is rolled back.
import { after } from "node:test";
import assert from "node:assert/strict";
import {
  saveAutomation,
  setAutomationActive,
} from "../lib/automations/admin.ts";
import { watchTriggers } from "../lib/automations/watch.ts";
import {
  importWatiHistory,
  type WatiContact,
  type WatiConversation,
  type WatiHistoryMessage,
  type WatiReader,
} from "../lib/wati/history.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

const rnd = () => crypto.randomUUID().slice(0, 8);
const phone = () => `6012${Math.floor(1000000 + Math.random() * 8999999)}`;
const unix = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

type Chat = {
  contact: WatiContact;
  conversation: WatiConversation;
  messages: WatiHistoryMessage[];
};

function chat(
  wa: string,
  messages: Partial<WatiHistoryMessage>[],
  lastUpdated = "2026-11-01T00:00:00.000Z",
): Chat {
  const contactId = `c-${rnd()}`;
  const convId = `v-${rnd()}`;
  return {
    contact: { id: contactId, waId: wa, phone: wa, name: "Someone" },
    conversation: { id: convId, contactId, lastUpdated },
    messages: messages.map((m) => ({
      id: `m-${rnd()}`,
      eventType: "message",
      owner: false,
      type: "text",
      text: "hello",
      status: "SENT",
      timestamp: unix("2026-10-01T02:00:00.000Z"),
      ...m,
    })),
  };
}

function reader(chats: Chat[]) {
  const asked: string[] = [];
  const r: WatiReader = {
    contacts: async () => chats.map((c) => c.contact),
    conversations: async () => chats.map((c) => c.conversation),
    messages: async (id) => {
      asked.push(id);
      return chats.find((c) => c.conversation.id === id)!.messages;
    },
  };
  return { r, asked };
}

const messagesOf = async (personId: string) =>
  db()`SELECT direction, body, status, imported, sent_at, created_at,
              external_message_id
       FROM sales.message WHERE person_id = ${personId} ORDER BY sent_at, id`;

async function crmPerson(wa: string) {
  const p = await newPerson("In CRM");
  await db()`UPDATE person SET phone_e164 = ${`+${wa}`}, phone = ${wa} WHERE id = ${p}`;
  return p;
}

it("a CRM person's chat comes in with original times, direction and status, marked imported", async () => {
  const wa = phone();
  const p = await crmPerson(wa);
  const c = chat(wa, [
    {
      owner: false,
      text: "Is the Dec class open?",
      timestamp: unix("2026-10-01T02:00:00.000Z"),
      status: "SENT",
    },
    {
      owner: true,
      text: "Yes, seats left.",
      timestamp: unix("2026-10-01T02:05:00.000Z"),
      status: "READ",
    },
    {
      owner: true,
      text: "Sent, not read",
      timestamp: unix("2026-10-01T02:06:00.000Z"),
      status: "DELIVERED",
    },
    {
      owner: false,
      type: "image",
      text: "",
      timestamp: unix("2026-10-02T02:00:00.000Z"),
    },
    {
      owner: false,
      type: "image",
      text: "my receipt",
      timestamp: unix("2026-10-02T02:30:00.000Z"),
    },
    {
      eventType: "ticket",
      owner: false,
      text: "assigned",
      timestamp: unix("2026-10-02T03:00:00.000Z"),
    },
  ]);
  const stats = await importWatiHistory(reader([c]).r, {});
  assert.equal(stats["new message"], 5);
  assert.equal(stats["skip: not a message event"], 1);

  const msgs = await messagesOf(p);
  assert.deepEqual(
    msgs.map((m) => [m.direction, m.body, m.status]),
    [
      ["in", "Is the Dec class open?", "received"],
      ["out", "Yes, seats left.", "read"],
      ["out", "Sent, not read", "delivered"],
      ["in", "[image]", "received"],
      ["in", "[image] my receipt", "received"],
    ],
  );
  assert.ok(msgs.every((m) => m.imported === true));
  assert.equal(msgs[0].sent_at.toISOString(), "2026-10-01T02:00:00.000Z");
  assert.equal(
    msgs[0].created_at.toISOString(),
    "2026-10-01T02:00:00.000Z",
    "created_at is the original time too: nothing looks new",
  );
  const [conv] = await db()`
    SELECT external_thread_id, channel, last_message_at, last_inbound_at
    FROM sales.conversation WHERE person_id = ${p}`;
  assert.equal(conv.channel, "whatsapp");
  assert.equal(conv.external_thread_id, wa, "same thread id the webhook uses");
  assert.equal(conv.last_message_at.toISOString(), "2026-10-02T02:30:00.000Z");
  assert.equal(conv.last_inbound_at.toISOString(), "2026-10-02T02:30:00.000Z");
});

it("people not in the CRM, contacts without a phone, and old chats are skipped and counted; no person is created", async () => {
  const known = phone();
  await crmPerson(known);
  const stranger = chat(phone(), [{}]);
  const noPhone = chat(phone(), [{}]);
  noPhone.contact.waId = null;
  noPhone.contact.phone = null;
  const old = chat(known, [{}], "2025-11-01T00:00:00.000Z");
  const ok = chat(known, [{ text: "recent" }], "2026-11-05T00:00:00.000Z");
  const before = (await db()`SELECT count(*)::int AS n FROM person`)[0].n;
  const { r, asked } = reader([stranger, noPhone, old, ok]);

  const stats = await importWatiHistory(r, {
    days: 30,
    now: new Date("2026-11-06T00:00:00.000Z"),
  });
  assert.equal(stats["skip: no CRM person"], 1);
  assert.equal(stats["skip: contact has no phone"], 1);
  assert.equal(stats["skip: older than 30 days"], 1);
  assert.equal(stats["new message"], 1);
  assert.deepEqual(
    asked,
    [ok.conversation.id],
    "history is read only for chats we import",
  );
  assert.equal(
    (await db()`SELECT count(*)::int AS n FROM person`)[0].n,
    before,
  );
});

it("a second run adds nothing, and a message the webhook already saved is not doubled", async () => {
  const wa = phone();
  const p = await crmPerson(wa);
  const c = chat(wa, [
    { text: "first", timestamp: unix("2026-10-03T02:00:00.000Z") },
    { text: "from webhook", timestamp: unix("2026-10-03T02:01:00.000Z") },
  ]);
  // The webhook saved the second one earlier under WATI's WhatsApp id.
  const [conv] = await db()`
    INSERT INTO sales.conversation (person_id, channel, external_thread_id, last_message_at)
    VALUES (${p}, 'whatsapp', ${wa}, '2026-10-03T02:01:00Z') RETURNING id`;
  await db()`
    INSERT INTO sales.message (conversation_id, person_id, channel, direction, external_message_id, body, sent_at, status)
    VALUES (${conv.id}, ${p}, 'whatsapp', 'in', 'wamid.HBg', 'from webhook', '2026-10-03T02:01:01Z', 'received')`;

  const first = await importWatiHistory(reader([c]).r, {});
  assert.equal(first["new message"], 1);
  assert.equal(first["skip: message already there"], 1);
  const again = await importWatiHistory(reader([c]).r, {});
  assert.equal(again["new message"] ?? 0, 0);
  assert.equal(again["skip: message already there"], 2);
  assert.equal((await messagesOf(p)).length, 2);
});

it("an imported customer message starts no automation; a live one still does", async () => {
  const b = await newUser("management");
  await newUser("super_admin");
  await db()`DELETE FROM sales.automation`;
  await db()`DELETE FROM sales.automation_cursor`;
  await db()`
    INSERT INTO sales.automation_cursor (name, read_until)
    SELECT n, now() - interval '1 hour'
    FROM unnest(ARRAY['outbox','ticket','message','lms_account']) AS n`;
  const id = await saveAutomation(b, {
    name: "Reply tag",
    trigger: "MessageReceived",
    conditions: [],
    steps: [{ kind: "add_tag", settings: { tag: "Replied" } }],
  });
  await setAutomationActive(b, id, true);
  // Switched on a day ago, so a message from minutes ago is not excused by
  // coming before switch-on.
  await db()`UPDATE sales.automation SET active_since = now() - interval '1 day' WHERE id = ${id}`;

  const wa = phone();
  const p = await crmPerson(wa);
  // A chat from minutes ago: inside the watcher's window even by its own time.
  const recent = new Date(Date.now() - 5 * 60_000).toISOString();
  await importWatiHistory(
    reader([chat(wa, [{ text: "just now", timestamp: unix(recent) }])]).r,
    {},
  );
  assert.equal(await watchTriggers(), 0, "imported: nothing starts");

  const [conv] =
    await db()`SELECT id FROM sales.conversation WHERE person_id = ${p}`;
  await db()`
    INSERT INTO sales.message (conversation_id, person_id, channel, direction, external_message_id, body, status, created_at)
    VALUES (${conv.id}, ${p}, 'whatsapp', 'in', ${`live-${rnd()}`}, 'live', 'received', clock_timestamp())`;
  assert.equal(await watchTriggers(), 1, "a live message still triggers");
});

it("a Malaysian number saved without its country code still finds the CRM person", async () => {
  const p = await crmPerson("60123456781");
  const c = chat("0123456781", [{ text: "hi" }]);
  const stats = await importWatiHistory(reader([c]).r, {});
  assert.equal(stats["new message"], 1);
  assert.equal((await messagesOf(p)).length, 1);
});
