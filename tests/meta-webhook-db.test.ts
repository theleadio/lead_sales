// Meta Lead Ads webhook (lib/meta/webhook.ts): signature and handshake,
// reading notices, mapping a lead's answers, and saving it through
// captureMetaLead() with retries. The Graph API is faked.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  integrationHealth,
  retryIntegration,
} from "../lib/health/integrations.ts";
import {
  CONFIRMED_FIELDS,
  LEAD_FIELDS,
  MAX_ATTEMPTS,
  leadNotices,
  mapLead,
  processLead,
  recordNotices,
  runMetaQueue,
  subscriptionChallenge,
  verifyMetaSignature,
  type MetaDeps,
  type MetaLead,
} from "../lib/meta/webhook.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const SECRET = "app-secret-for-tests";
const sign = (body: string) =>
  `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

test("the signature: sha256 of the raw body with the app secret", () => {
  const body = '{"object":"page","entry":[]}';
  assert.equal(verifyMetaSignature(body, sign(body), SECRET), true);
  assert.equal(verifyMetaSignature(body + " ", sign(body), SECRET), false);
  assert.equal(verifyMetaSignature(body, sign(body), "other"), false);
  assert.equal(verifyMetaSignature(body, null, SECRET), false);
  assert.equal(
    verifyMetaSignature(body, sign(body).replace("sha256=", "sha1="), SECRET),
    false,
  );
  assert.equal(verifyMetaSignature(body, sign(body), ""), false);
});

test("the handshake answers the challenge only for our verify token", () => {
  const q = (token: string, mode = "subscribe") =>
    new URLSearchParams({
      "hub.mode": mode,
      "hub.verify_token": token,
      "hub.challenge": "1158201444",
    });
  assert.equal(subscriptionChallenge(q("ours"), "ours"), "1158201444");
  assert.equal(subscriptionChallenge(q("theirs"), "ours"), null);
  assert.equal(subscriptionChallenge(q("ours", "unsubscribe"), "ours"), null);
  assert.equal(subscriptionChallenge(q(""), ""), null, "closed unless set");
});

test("notices: only leadgen changes with a numeric lead id", () => {
  const notices = leadNotices({
    object: "page",
    entry: [
      {
        id: "111",
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: "4444",
              form_id: "555",
              ad_id: "666",
              page_id: "111",
            },
          },
          { field: "feed", value: { leadgen_id: "1" } },
          { field: "leadgen", value: { leadgen_id: "../me" } },
        ],
      },
      { changes: [{ field: "leadgen", value: { leadgen_id: 7777 } }] },
    ],
  });
  assert.deepEqual(notices, [
    { leadgenId: "4444", formId: "555", adId: "666", pageId: "111" },
    { leadgenId: "7777", formId: null, adId: null, pageId: null },
  ]);
  assert.deepEqual(leadNotices(null), []);
  assert.deepEqual(leadNotices({ entry: "x" }), []);
});

const leadOf = (id: string, over: Partial<MetaLead> = {}): MetaLead => ({
  id,
  created_time: "2026-11-04T09:00:00+0000",
  ad_id: "120210000000099",
  form_id: "9001",
  campaign_id: "120210000000001",
  platform: "ig",
  field_data: [
    { name: "full_name", values: ["Tan Mei Ling"] },
    {
      name: "email",
      values: [`meiling-${crypto.randomUUID().slice(0, 8)}@example.test`],
    },
    { name: "phone_number", values: ["+60123456789"] },
    { name: "which_course", values: ["AI365"] },
    { name: "using_hrdc", values: ["Yes, my company is registered"] },
    { name: "language", values: ["中文"] },
  ],
  ...over,
});

test("mapping: standard questions, the form's custom questions, ad ids", () => {
  const m = mapLead(leadOf("4444"), {
    name: "AI365 March (IG)",
    fields: {
      which_course: "courseInterest",
      using_hrdc: "hrdcIntended",
      language: "preferredLanguage",
    },
  });
  assert.equal(m.fullName, "Tan Mei Ling");
  assert.equal(m.phone, "+60123456789");
  assert.equal(m.courseInterest, "AI365");
  assert.equal(m.hrdcIntended, true);
  assert.equal(m.preferredLanguage, "zh");
  assert.equal(m.consentMarketing, false, "no consent question mapped");
  assert.equal(m.formName, "AI365 March (IG)");
  assert.equal(m.idempotencyKey, "meta-leadgen:4444");
  assert.equal(m.adId, "120210000000099");
  assert.equal(m.campaignId, "120210000000001");
  assert.equal(m.attribution?.utmSource, "instagram");

  // No form row: custom questions are not guessed; first + last name.
  const bare = mapLead(
    leadOf("4445", {
      platform: undefined,
      field_data: [
        { name: "first_name", values: ["Ah"] },
        { name: "last_name", values: ["Kow"] },
        { name: "work_email", values: ["ahkow@example.test"] },
        { name: "using_hrdc", values: ["Yes"] },
      ],
    }),
    null,
  );
  assert.equal(bare.fullName, "Ah Kow");
  assert.equal(bare.email, "ahkow@example.test");
  assert.equal(bare.hrdcIntended, false);
  assert.equal(bare.formName, "Meta lead form 9001");
  assert.equal(bare.attribution?.utmSource, "facebook");

  // A bad mapping value is ignored, not trusted.
  const odd = mapLead(leadOf("4446"), {
    name: null,
    fields: { which_course: "deleted_at" },
  });
  assert.equal(odd.courseInterest, null);
});

// A fake Graph API: answers from `leads`, or fails as told.
function fakeGraph(
  leads: Record<string, MetaLead>,
  fail: { status: number; code?: number; whenFields?: string } | null = null,
) {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    calls.push(url.searchParams.get("fields") ?? "");
    if (
      fail &&
      (!fail.whenFields || url.searchParams.get("fields") === fail.whenFields)
    )
      return new Response(
        JSON.stringify({ error: { message: "nope", code: fail.code ?? 1 } }),
        { status: fail.status },
      );
    const id = url.pathname.split("/").pop()!;
    const lead = leads[id];
    if (!lead)
      return new Response(
        JSON.stringify({ error: { message: "no", code: 100 } }),
        {
          status: 400,
        },
      );
    return new Response(JSON.stringify(lead), { status: 200 });
  }) as typeof fetch;
  const deps: MetaDeps = { accessToken: "token", fetchImpl };
  return { deps, calls };
}

const newId = () =>
  String(Date.now()) + String(Math.floor(Math.random() * 1e6));

async function notice(leadgenId: string) {
  return recordNotices([
    { leadgenId, formId: "9001", adId: "120210000000099", pageId: "111" },
  ]);
}

it("a notice is recorded once and the lead saved as person, deal and lead_form touchpoint", async () => {
  const id = newId();
  assert.deepEqual(await notice(id), [id]);
  assert.deepEqual(await notice(id), [], "a repeated notice is not new");

  await db()`
    INSERT INTO sales.meta_form (form_id, name, fields)
    VALUES ('9001', 'AI365 March (IG)', '{"which_course":"courseInterest"}')
    ON CONFLICT (form_id) DO UPDATE SET name = EXCLUDED.name, fields = EXCLUDED.fields`;
  const g = fakeGraph({ [id]: leadOf(id) });
  const r = await processLead(id, g.deps);
  assert.equal(r.kind, "saved");
  assert.deepEqual(g.calls, [LEAD_FIELDS]);
  if (r.kind !== "saved") return;

  const [t] = await db()`
    SELECT channel, utm_campaign_id, utm_ad_id, utm_source, form_name, external_ref
    FROM touchpoint WHERE person_id = ${r.personId}`;
  assert.equal(t.channel, "lead_form");
  assert.equal(t.utm_ad_id, "120210000000099");
  assert.equal(t.utm_campaign_id, "120210000000001");
  assert.equal(t.utm_source, "instagram");
  assert.equal(t.form_name, "AI365 March (IG)");
  assert.equal(t.external_ref, `meta-leadgen:${id}`);
  const [e] = await db()`
    SELECT status, attempts, payload FROM integration_event
    WHERE source = 'meta_leadgen' AND external_event_id = ${id}`;
  assert.equal(e.status, "processed");
  assert.equal(e.payload.leadgenId, id);
  assert.equal("field_data" in e.payload, false, "no answers are kept");

  assert.equal((await processLead(id, g.deps)).kind, "busy", "done once");
});

it("Graph down: the lead waits, then meta:run saves it", async () => {
  const id = newId();
  await notice(id);
  const down = fakeGraph({}, { status: 500 });
  const r = await processLead(id, down.deps);
  assert.equal(r.kind, "failed");
  let [e] = await db()`
    SELECT status, attempts, next_attempt_at > now() AS later
    FROM integration_event WHERE source = 'meta_leadgen' AND external_event_id = ${id}`;
  assert.equal(e.status, "failed");
  assert.equal(e.attempts, 1);
  assert.equal(e.later, true);

  await db()`
    UPDATE integration_event SET next_attempt_at = now()
    WHERE source = 'meta_leadgen' AND external_event_id = ${id}`;
  const up = fakeGraph({ [id]: leadOf(id) });
  const run = await runMetaQueue(up.deps);
  assert.ok(run.saved >= 1);
  [e] = await db()`
    SELECT status FROM integration_event
    WHERE source = 'meta_leadgen' AND external_event_id = ${id}`;
  assert.equal(e.status, "processed");
});

it("if Meta rejects campaign_id or platform, the confirmed fields are read instead", async () => {
  const id = newId();
  await notice(id);
  const g = fakeGraph(
    { [id]: leadOf(id, { campaign_id: undefined, platform: undefined }) },
    { status: 400, code: 100, whenFields: LEAD_FIELDS },
  );
  assert.equal((await processLead(id, g.deps)).kind, "saved");
  assert.deepEqual(g.calls, [LEAD_FIELDS, CONFIRMED_FIELDS]);
});

it("answers with no email and no phone: not retried, marketing get a task, health can revive it", async () => {
  await newUser("marketing");
  const id = newId();
  await notice(id);
  const g = fakeGraph({
    [id]: leadOf(id, {
      field_data: [{ name: "full_name", values: ["No Contact"] }],
    }),
  });
  const r = await processLead(id, g.deps);
  assert.equal(r.kind, "failed");
  assert.equal(r.kind === "failed" && r.final, true);
  const [e] = await db()`
    SELECT id, attempts FROM integration_event
    WHERE source = 'meta_leadgen' AND external_event_id = ${id}`;
  assert.equal(e.attempts, MAX_ATTEMPTS);
  const [t] = await db()`
    SELECT t.title, u.role_code FROM task t JOIN app_user u ON u.id = t.assigned_user_id
    WHERE t.source_key = ${`meta-lead:${id}:lost`}`;
  assert.match(t.title, /Meta lead could not be saved/);
  assert.equal(t.role_code, "marketing");

  const h = (await integrationHealth()).find((x) => x.key === "meta_leads")!;
  assert.equal(h.status, "degraded");
  assert.ok(h.retryable.some((x) => x.id === e.id));
  assert.equal(
    await retryIntegration({ integration: "meta_leads", ids: [e.id] }),
    1,
  );
  const [again] = await db()`
    SELECT attempts FROM integration_event WHERE id = ${e.id}`;
  assert.equal(again.attempts, 0, "due again on the next meta:run");
});

it("after the last try a failing lead stops and gets a task", async () => {
  const id = newId();
  await notice(id);
  const down = fakeGraph({}, { status: 503 });
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await db()`
      UPDATE integration_event SET next_attempt_at = now()
      WHERE source = 'meta_leadgen' AND external_event_id = ${id}`;
    await processLead(id, down.deps);
  }
  const [e] = await db()`
    SELECT attempts, status FROM integration_event
    WHERE source = 'meta_leadgen' AND external_event_id = ${id}`;
  assert.equal(e.attempts, MAX_ATTEMPTS);
  assert.equal((await processLead(id, down.deps)).kind, "busy");
  const tasks = await db()`
    SELECT 1 FROM task WHERE source_key = ${`meta-lead:${id}:lost`}`;
  assert.equal(tasks.length, 1);
});
