// Shared fixtures for the sites stats / CAPI tests (not a test file).
import assert from "node:assert/strict";
import { createFunnel, getSite, updateSiteSettings } from "../lib/sites/admin.ts";
import { publishPage } from "../lib/sites/publish.ts";
import { db } from "../lib/sql.ts";
import { enrol, newClass, newPerson, newUser, pay } from "./seed.ts";

const settings = { pixels: {}, capi: false, paymentMode: "test" as const, seo: {}, privacyUrl: "https://example.com/privacy" };

// A funnel whose first step is published with one form named `formName`.
export async function liveFunnel(opts: { formName: string; capi?: boolean }) {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: `/t-${crypto.randomUUID().slice(0, 8)}` });
  let s = (await getSite(m, siteId))!;
  await updateSiteSettings(m, siteId, { ...settings, capi: opts.capi ?? false }, s.version);
  s = (await getSite(m, siteId))!;
  const form = JSON.stringify({
    type: "interest", formName: opts.formName, fields: [], createDeal: false, after: { kind: "message", text: "ok" },
  });
  await db()`UPDATE sales.page_version SET html = ${`<div data-lead="form" data-settings='${form}'></div>`} WHERE page_id = ${s.steps[0].id} AND status = 'draft'`;
  assert.equal((await publishPage(m, s.steps[0].id, s.steps[0].version)).kind, "ok");
  return { m, siteId, steps: s.steps };
}

// A person who opted in on `path`, with a deal sourced from that touch and one
// enrolment carrying a payment.
export async function buyer(path: string, formName: string, amount: string, refunded = "0", sourced = true) {
  const personId = await newPerson("Buyer", null);
  const [t] = await db()`
    INSERT INTO touchpoint (person_id, channel, landing_url, form_name, fbclid)
    VALUES (${personId}, 'web_form', ${`https://ai.thelead.io${path}?x=1`}, ${formName}, 'abc')
    RETURNING id`;
  const [d] = await db()`
    INSERT INTO deal (pipeline, stage, person_id, source_touchpoint_id)
    VALUES ('individual', 'new', ${personId}, ${sourced ? t.id : null}) RETURNING id`;
  const e = await enrol(await newClass(), "confirmed", { personId });
  await db()`UPDATE enrolment SET deal_id = ${d.id} WHERE id = ${e}`;
  const p = await pay(e, { amount });
  if (refunded !== "0") await db()`UPDATE payment SET status = 'partially_refunded', refunded_amount_myr = ${refunded}, refunded_at = now() WHERE id = ${p}`;
  return { personId, paymentId: p };
}

