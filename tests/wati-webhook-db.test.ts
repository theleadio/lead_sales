// WATI webhook (lib/wati/webhook.ts): the shared-secret check, an inbound
// WhatsApp message becoming person + conversation + message, messages sent
// from the WATI app, delivery status events, and the retry queue. The
// payloads follow WATI's webhook reference (docs.wati.io, 6 Nov). Each DB
// test is rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS,
  eventKey,
  processWatiEvent,
  recordWatiEvent,
  runWatiQueue,
  verifyWatiToken,
  type WatiEvent,
} from "../lib/wati/webhook.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson } from "./seed.ts";

after(closeDb);

test("the secret: exact match only, constant time, nothing set = refused", () => {
  assert.equal(
    verifyWatiToken("s3cret-value-of-length", "s3cret-value-of-length"),
    true,
  );
  assert.equal(
    verifyWatiToken("s3cret-value-of-length ", "s3cret-value-of-length"),
    false,
  );
  assert.equal(verifyWatiToken("other", "s3cret-value-of-length"), false);
  assert.equal(verifyWatiToken(null, "s3cret-value-of-length"), false);
  assert.equal(verifyWatiToken("", ""), false);
});

test("event key: type plus the WhatsApp message id; none = no key", () => {
  assert.equal(
    eventKey({ eventType: "message", whatsappMessageId: "wamid.A", id: "x" }),
    "message:wamid.A",
  );
  assert.equal(
    eventKey({ eventType: "message", id: "rec-1" }),
    "message:rec-1",
  );
  assert.equal(eventKey({ eventType: "message" }), null);
  assert.equal(eventKey({ id: "rec-1" }), null);
});

const rnd = () => crypto.randomUUID().slice(0, 8);
const phone = () => `6012${Math.floor(1000000 + Math.random() * 8999999)}`;

const inbound = (waId: string, over: Partial<WatiEvent> = {}): WatiEvent => ({
  eventType: "message",
  id: `rec-${rnd()}`,
  whatsappMessageId: `wamid.${rnd()}`,
  conversationId: `conv-${rnd()}`,
  waId,
  senderName: "Lim Wei Jie",
  text: "Hi, is the Dec class still open?",
  type: "text",
  data: null,
  timestamp: "1767225600",
  ...over,
});

async function handle(e: WatiEvent) {
  const key = eventKey(e)!;
  await recordWatiEvent(key, e);
  return processWatiEvent(key);
}

const messagesOf = async (personId: string) =>
  db()`SELECT direction, body, status, external_message_id, sent_at
       FROM sales.message WHERE person_id = ${personId} ORDER BY sent_at, created_at`;

it("an inbound message from a new number makes the person, the thread and the message", async () => {
  const wa = phone();
  const e = inbound(wa);
  const r = await handle(e);
  assert.equal(r.kind, "saved");

  const [p] = await db()`
    SELECT id, full_name, phone_e164, whatsapp_e164 FROM person WHERE phone_e164 = ${`+${wa}`}`;
  assert.equal(p.full_name, "Lim Wei Jie");
  assert.equal(p.whatsapp_e164, `+${wa}`);
  const [c] = await db()`
    SELECT id, channel, external_thread_id, last_inbound_at, last_message_at
    FROM sales.conversation WHERE person_id = ${p.id}`;
  assert.equal(c.channel, "whatsapp");
  assert.equal(
    c.external_thread_id,
    wa,
    "one thread per customer: their WhatsApp id",
  );
  const msgs = await messagesOf(p.id);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].direction, "in");
  assert.equal(msgs[0].body, "Hi, is the Dec class still open?");
  assert.equal(msgs[0].status, "received");
  assert.equal(msgs[0].external_message_id, e.whatsappMessageId);
  assert.equal(
    msgs[0].sent_at.toISOString(),
    "2026-01-01T00:00:00.000Z",
    "WATI's unix time, not now",
  );
  assert.equal(c.last_inbound_at.toISOString(), "2026-01-01T00:00:00.000Z");

  // The stored event keeps no customer text once it is processed.
  const [ev] = await db()`
    SELECT status, payload FROM integration_event
    WHERE source = 'wati' AND external_event_id = ${eventKey(e)}`;
  assert.equal(ev.status, "processed");
  assert.equal(JSON.stringify(ev.payload).includes("Dec class"), false);
});

it("a redelivered event and a second message from a known number add nothing extra", async () => {
  const wa = phone();
  const known = await newPerson("Already In CRM");
  await db()`UPDATE person SET phone_e164 = ${`+${wa}`}, phone = ${wa} WHERE id = ${known}`;
  const first = inbound(wa, { senderName: "Someone Else" });
  await handle(first);
  assert.deepEqual(
    (await handle(first)).kind,
    "duplicate",
    "the same event twice does the work once",
  );
  await handle(inbound(wa, { text: "Second question" }));

  assert.equal(
    (
      await db()`SELECT count(*)::int AS n FROM person WHERE phone_e164 = ${`+${wa}`}`
    )[0].n,
    1,
    "the hard phone match is the person: no second record, no rename",
  );
  const msgs = await messagesOf(known);
  assert.deepEqual(
    msgs.map((m) => m.body),
    ["Hi, is the Dec class still open?", "Second question"],
  );
  assert.equal(
    (
      await db()`SELECT count(*)::int AS n FROM sales.conversation WHERE person_id = ${known}`
    )[0].n,
    1,
  );
});

it("media without text gets a placeholder; a number that is not a phone fails for good", async () => {
  const wa = phone();
  await handle(
    inbound(wa, {
      type: "image",
      text: null,
      data: { mimeType: "image/jpeg" },
    }),
  );
  const [p] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${wa}`}`;
  assert.equal((await messagesOf(p.id))[0].body, "[image]");

  const bad = inbound("12", { text: "x" });
  const r = await handle(bad);
  assert.equal(r.kind, "failed");
  assert.equal(
    r.kind === "failed" && r.final,
    true,
    "retrying cannot fix a bad number",
  );
});

it("a message typed in the WATI app is saved as ours; delivery and read events move it on, never back", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const [p] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${wa}`}`;
  const wamid = `wamid.${rnd()}`;
  const sent: WatiEvent = {
    eventType: "sessionMessageSent_v2",
    id: `rec-${rnd()}`,
    whatsappMessageId: wamid,
    waId: wa,
    text: "Yes, 9-10 Dec still has seats.",
    timestamp: "1767225660",
  };
  await handle(sent);
  const status = async () =>
    (await messagesOf(p.id)).find((m) => m.direction === "out")!;
  assert.equal((await status()).body, "Yes, 9-10 Dec still has seats.");
  assert.equal((await status()).status, "sent");

  await handle({
    eventType: "sentMessageREAD_v2",
    id: "r1",
    whatsappMessageId: wamid,
    waId: wa,
  });
  assert.equal((await status()).status, "read");
  await handle({
    eventType: "sentMessageDELIVERED_v2",
    id: "r2",
    whatsappMessageId: wamid,
    waId: wa,
  });
  assert.equal(
    (await status()).status,
    "read",
    "a late delivered event doesn't undo read",
  );
  await handle({
    eventType: "sessionMessageFailed",
    id: "r3",
    whatsappMessageId: wamid,
    waId: wa,
    failedCode: "131026",
  });
  assert.equal(
    (await status()).status,
    "read",
    "failed doesn't undo a read message",
  );
});

it("a failed template send marks our message failed and keeps the reason", async () => {
  const wa = phone();
  await handle(inbound(wa));
  const [p] = await db()`SELECT id FROM person WHERE phone_e164 = ${`+${wa}`}`;
  const wamid = `wamid.${rnd()}`;
  await handle({
    eventType: "templateMessageSent",
    id: `rec-${rnd()}`,
    whatsappMessageId: wamid,
    waId: wa,
    templateName: "onboarding_signoff",
    timestamp: "1767225700",
  });
  const out = (await messagesOf(p.id)).find((m) => m.direction === "out")!;
  assert.equal(out.body, "[template onboarding_signoff]");
  const f: WatiEvent = {
    eventType: "templateMessageFailed",
    id: "f1",
    whatsappMessageId: wamid,
    waId: wa,
    failedCode: "131026",
    failedDetail: "Message undeliverable",
  };
  await handle(f);
  assert.equal(
    (await messagesOf(p.id)).find((m) => m.direction === "out")!.status,
    "failed",
  );
  const [ev] = await db()`
    SELECT payload FROM integration_event WHERE source = 'wati' AND external_event_id = ${eventKey(f)}`;
  assert.equal(ev.payload.failedCode, "131026");
  assert.equal(ev.payload.failedDetail, "Message undeliverable");
});

it("a status for a message we never saw, and events we don't use, are ignored, not errors", async () => {
  const wa = phone();
  const r1 = await handle({
    eventType: "sentMessageDELIVERED_v2",
    id: "x1",
    whatsappMessageId: `wamid.${rnd()}`,
    waId: wa,
  });
  assert.equal(r1.kind, "ignored");
  const r2 = await handle({
    eventType: "newContactMessageReceived",
    id: `n-${rnd()}`,
    waId: wa,
  });
  assert.equal(r2.kind, "ignored");
  const r3 = await handle({
    eventType: "templateQualityUpdate",
    id: `q-${rnd()}`,
  });
  assert.equal(r3.kind, "ignored");
  assert.equal(
    (
      await db()`SELECT count(*)::int AS n FROM person WHERE phone_e164 = ${`+${wa}`}`
    )[0].n,
    0,
  );
});

it("a stored event that failed is tried again by the queue, then given up after the last try", async () => {
  const wa = phone();
  const e = inbound(wa);
  const key = eventKey(e)!;
  await recordWatiEvent(key, e);
  // Make the first try fail: the thread's column refuses the value.
  await db()`UPDATE integration_event SET payload = jsonb_set(payload, '{waId}', '"12"')
             WHERE source = 'wati' AND external_event_id = ${key}`;
  const a = await processWatiEvent(key);
  assert.equal(a.kind, "failed");
  // Not due yet when the failure was not final → nothing to run now.
  await db()`UPDATE integration_event SET status = 'failed', attempts = 1,
               next_attempt_at = now() - interval '1 minute',
               payload = ${db().json(e as never)}
             WHERE source = 'wati' AND external_event_id = ${key}`;
  const r = await runWatiQueue();
  assert.equal(r.saved, 1);
  const [ev] =
    await db()`SELECT status FROM integration_event WHERE source = 'wati' AND external_event_id = ${key}`;
  assert.equal(ev.status, "processed");

  const dead = inbound("12");
  await recordWatiEvent(eventKey(dead)!, dead);
  await db()`UPDATE integration_event SET status = 'failed', attempts = ${MAX_ATTEMPTS}
             WHERE source = 'wati' AND external_event_id = ${eventKey(dead)}`;
  assert.deepEqual(
    await runWatiQueue(),
    { saved: 0, failed: 0, lost: 0 },
    "out of tries: left for people",
  );
});
