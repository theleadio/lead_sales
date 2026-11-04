// Meta Lead Ads intake (lib/meta/intake.ts): saves the lead straight into
// the shared CRM database with the CRM's copied captureLead() rules, records
// a `lead_form` touchpoint with the ad ids, and never makes a second person
// or deal for a repeated key. Moved from lead_crm PR #46 (closed).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { captureLead } from "../lib/crm/leads.ts";
import { captureMetaLead, metaLeadSchema } from "../lib/meta/intake.ts";
import { closeDb, db } from "../lib/sql.ts";
import { leadSchema } from "../lib/crm/lead-schema.ts";
import { it } from "./seed.ts";

after(closeDb);

test("the body needs an idempotency key", () => {
  const base = { fullName: "Lim Ah Kow", email: "lim@example.test" };
  assert.equal(metaLeadSchema.safeParse(base).success, false);
  assert.equal(
    metaLeadSchema.safeParse({
      ...base,
      idempotencyKey: "meta-leadgen:1234567",
    }).success,
    true,
  );
});

const metaLead = (over: Record<string, unknown> = {}) =>
  metaLeadSchema.parse({
    fullName: "Tan Mei Ling",
    email: `meiling-${crypto.randomUUID().slice(0, 8)}@example.test`,
    phone: "012-345 6789",
    formName: "Meta: AI365 March",
    consentMarketing: true,
    idempotencyKey: `meta-leadgen:${crypto.randomUUID()}`,
    campaignId: "120210000000001",
    adId: "120210000000099",
    attribution: { utmSource: "facebook", utmCampaign: "AI365 March" },
    ...over,
  });

it("a Meta lead becomes a person, a deal and a lead_form touchpoint with the ad ids", async () => {
  const r = await captureMetaLead(metaLead());
  assert.equal(r.replayed, false);
  const [t] = await db()`
    SELECT channel, utm_campaign_id, utm_ad_id, utm_source, form_name
    FROM touchpoint WHERE person_id = ${r.personId}`;
  assert.equal(t.channel, "lead_form");
  assert.equal(t.utm_campaign_id, "120210000000001");
  assert.equal(t.utm_ad_id, "120210000000099");
  assert.equal(t.utm_source, "facebook");
  assert.equal(t.form_name, "Meta: AI365 March");
  const [d] = await db()`SELECT id FROM deal WHERE id = ${r.dealId}`;
  assert.ok(d);
  // Consent was ticked, so ConsentChanged is raised alongside LeadCaptured.
  const types = (
    await db()`
      SELECT type FROM event_outbox WHERE aggregate_id = ${r.personId}
      ORDER BY type`
  ).map((x) => x.type as string);
  // One per purpose: marketing email and marketing WhatsApp.
  assert.deepEqual(types, ["ConsentChanged", "ConsentChanged", "LeadCaptured"]);
  // Recorded as given on the Meta form, not the website (PDPA record).
  const sources = await db()`
    SELECT DISTINCT source FROM consent WHERE person_id = ${r.personId}`;
  assert.deepEqual(
    sources.map((x) => x.source),
    ["lead_form"],
  );
});

it("the same Meta lead delivered twice makes one person and one deal", async () => {
  const lead = metaLead();
  const first = await captureMetaLead(lead);
  const again = await captureMetaLead(lead);
  assert.equal(again.replayed, true);
  assert.equal(again.personId, first.personId);
  assert.equal(again.dealId, first.dealId);
  const touches = await db()`
    SELECT 1 FROM touchpoint WHERE external_ref = ${lead.idempotencyKey}`;
  assert.equal(touches.length, 1);
});

it("a Meta lead for someone already in the CRM attaches to that person (same dedupe as the website)", async () => {
  const email = `known-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const web = await captureLead(
    leadSchema.parse({ fullName: "Known Person", email }),
    { landingUrl: null, referrer: null },
  );
  const meta = await captureMetaLead(metaLead({ email }));
  assert.equal(meta.personId, web.personId);
});

it("website leads are unchanged: still web_form, with no ad ids", async () => {
  const r = await captureLead(
    leadSchema.parse({
      fullName: "Web Visitor",
      email: `web-${crypto.randomUUID().slice(0, 8)}@example.test`,
      idempotencyKey: `web:${crypto.randomUUID()}`,
    }),
    { landingUrl: null, referrer: null },
  );
  const [t] = await db()`
    SELECT channel, utm_campaign_id, utm_ad_id FROM touchpoint
    WHERE person_id = ${r.personId}`;
  assert.equal(t.channel, "web_form");
  assert.equal(t.utm_campaign_id, null);
  assert.equal(t.utm_ad_id, null);
});
