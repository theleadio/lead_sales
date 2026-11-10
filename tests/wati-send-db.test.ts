// Sending through WATI (lib/wati/send.ts). WATI is a fake fetch that records
// what it was asked; each DB test is rolled back.
import { after } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import { sendInboxReply, watiSender } from "../lib/wati/send.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

type Call = { url: string; body: Record<string, unknown>; auth: string };
function fake(status = 200, json: unknown = { result: true }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      auth: (init.headers as Record<string, string>).Authorization,
    });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return {
    calls,
    o: {
      host: "https://live-mt-server.wati.io/12345",
      token: "tok",
      fetchImpl,
    },
  };
}

const wa = () => `6012${Math.floor(1000000 + Math.random() * 8999999)}`;

async function chat(inboundAgo: string | null) {
  const number = wa();
  const p = await newPerson("Chat person");
  await db()`UPDATE person SET phone_e164 = ${`+${number}`}, whatsapp_e164 = ${`+${number}`}, phone = ${number} WHERE id = ${p}`;
  const [c] = await db()`
    INSERT INTO sales.conversation (person_id, channel, external_thread_id, last_inbound_at)
    VALUES (${p}, 'whatsapp', ${number},
            ${inboundAgo === null ? null : db()`now() - ${inboundAgo}::interval`})
    RETURNING id`;
  return { p, number, conv: c.id as string };
}

it("a reply inside the window is sent to the number and saved as ours, sent", async () => {
  const u = await newUser("management");
  const { conv, number } = await chat("1 hour");
  const { calls, o } = fake();
  await sendInboxReply(o, u, conv, "  Yes, seats left.  ");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://live-mt-server.wati.io/api/ext/v3/conversations/messages/text",
  );
  assert.deepEqual(calls[0].body, { target: number, text: "Yes, seats left." });
  assert.equal(calls[0].auth, "Bearer tok");
  const [m] = await db()`
    SELECT direction, body, status, sent_by_user_id FROM sales.message
    WHERE conversation_id = ${conv}`;
  assert.deepEqual(
    [m.direction, m.body, m.status, m.sent_by_user_id],
    ["out", "Yes, seats left.", "sent", u.id],
  );
});

it("a closed window sends nothing", async () => {
  const u = await newUser("management");
  const { conv } = await chat("30 hours");
  const { calls, o } = fake();
  await assert.rejects(sendInboxReply(o, u, conv, "hi"), /window/);
  assert.equal(calls.length, 0);
});

it("WATI refusing the message marks it failed and tells the user", async () => {
  const u = await newUser("management");
  const { conv } = await chat("1 hour");
  for (const f of [fake(500), fake(200, { result: false })]) {
    await assert.rejects(sendInboxReply(f.o, u, conv, "hi"), /did not accept/);
  }
  const rows =
    await db()`SELECT status FROM sales.message WHERE conversation_id = ${conv}`;
  assert.deepEqual(
    rows.map((r) => r.status),
    ["failed", "failed"],
  );
});

it("an automation step sends the template with our key as local_message_id, then saves it", async () => {
  const { p, number } = await chat(null);
  const { calls, o } = fake();
  await watiSender(o)({
    channel: "whatsapp",
    template: "onboarding_en",
    personId: p,
    to: `+${number}`,
    language: "en",
    context: {},
    idempotencyKey: "auto:run1:2",
  });
  assert.equal(
    calls[0].url,
    "https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send",
  );
  const body = calls[0].body as {
    template_name: string;
    recipients: { target: string; local_message_id: string }[];
  };
  assert.equal(body.template_name, "onboarding_en");
  assert.equal(body.recipients[0].target, number);
  assert.equal(body.recipients[0].local_message_id, "auto:run1:2");
  const [m] = await db()`
    SELECT body, status, external_message_id FROM sales.message WHERE person_id = ${p}`;
  assert.deepEqual(
    [m.body, m.status, m.external_message_id],
    ["[template] onboarding_en", "sent", "auto:run1:2"],
  );
});

it("a failed template send saves nothing, so the engine retries it", async () => {
  const { p, number } = await chat(null);
  await assert.rejects(
    watiSender(fake(500).o)({
      channel: "whatsapp",
      template: "t",
      personId: p,
      to: number,
      language: "en",
      context: {},
      idempotencyKey: "auto:run2:1",
    }),
    /WATI answered 500/,
  );
  assert.equal(
    (
      await db()`SELECT count(*)::int AS n FROM sales.message WHERE person_id = ${p}`
    )[0].n,
    0,
  );
});
