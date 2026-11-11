// The automations' WhatsApp sender (lib/wati/sender.ts, kept from PR #21
// when the inbox moved to lead_crm). WATI is a fake fetch that records what
// it was asked; each DB test is rolled back. Needs lead_crm's migrations 019
// and 020 (its inbox tables).
import { after } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import { watiSender } from "../lib/wati/sender.ts";
import { it, newPerson } from "./seed.ts";

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

// A person with a WhatsApp number and no conversation yet.
async function chat() {
  const number = wa();
  const p = await newPerson("Chat person");
  await db()`UPDATE person SET phone_e164 = ${`+${number}`}, whatsapp_e164 = ${`+${number}`}, phone = ${number} WHERE id = ${p}`;
  return { p, number };
}

it("an automation step sends the template with our key as local_message_id, then saves it", async () => {
  const { p, number } = await chat();
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
    SELECT body, status, external_message_id FROM conversation_message WHERE person_id = ${p}`;
  assert.deepEqual(
    [m.body, m.status, m.external_message_id],
    ["[template] onboarding_en", "sent", "auto:run1:2"],
  );
});

it("a failed template send saves nothing, so the engine retries it", async () => {
  const { p, number } = await chat();
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
      await db()`SELECT count(*)::int AS n FROM conversation_message WHERE person_id = ${p}`
    )[0].n,
    0,
  );
});
