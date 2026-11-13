// lib/sites/forms: the LEAD form endpoint's logic, with a fake CRM.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getSite, updateSiteSettings } from "../lib/sites/admin.ts";
import { readCapped, submitForm, type FormRaw } from "../lib/sites/forms.ts";
import { publishPage } from "../lib/sites/publish.ts";
import type { CrmLeadInput } from "../lib/sites/crm-api.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const FORM_ID = "form-1";
const esc = (o: unknown) => JSON.stringify(o).replace(/"/g, "&quot;");

async function funnel(opts: { form: unknown; capi?: boolean; whatsapp?: string; publish?: boolean }) {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: `/t-${crypto.randomUUID().slice(0, 8)}` });
  let s = (await getSite(m, siteId))!;
  await updateSiteSettings(
    m,
    siteId,
    {
      pixels: {},
      capi: opts.capi ?? false,
      paymentMode: "test",
      seo: {},
      privacyUrl: "https://example.com/privacy",
      ...(opts.whatsapp && { chatWidget: { whatsapp: opts.whatsapp } }),
    },
    s.version,
  );
  s = (await getSite(m, siteId))!;
  const html = `<div data-lead="form" data-id="${FORM_ID}" data-settings="${esc(opts.form)}"></div>`;
  await db()`UPDATE sales.page_version SET html = ${html} WHERE page_id = ${s.steps[0].id} AND status = 'draft'`;
  if (opts.publish !== false) assert.equal((await publishPage(m, s.steps[0].id, s.steps[0].version)).kind, "ok");
  return { page: s.steps[0] };
}

const raw = (pageId: string, over: Partial<FormRaw> = {}): FormRaw => ({
  pageId,
  formId: FORM_ID,
  fullName: "Ann Lee",
  email: "ann@example.com",
  phone: "0123456789",
  consentMarketing: true,
  idempotencyKey: crypto.randomUUID(),
  landingUrl: "https://ai.thelead.io/x?utm_source=fb&utm_id=u1&utm_ad_id=a1&fbclid=FB1",
  referrer: null,
  ...over,
});

const fakeCrm = () => {
  const calls: CrmLeadInput[] = [];
  const crm = async (i: CrmLeadInput) => {
    calls.push(i);
    return { kind: "ok" as const, personId: "p", dealId: null };
  };
  return { calls, crm };
};

const interest = { type: "interest", formName: "My form", fields: ["company"], createDeal: true, after: { kind: "message", text: "thanks" } };
const workshop = {
  type: "workshop",
  workshop: { title: "AI Workshop", date: "2026-12-01", language: "zh" },
  fields: [],
  createDeal: true,
  after: { kind: "message", text: "thanks" },
};

it("workshop form sends the generated form name and createDeal from settings", async () => {
  const { page } = await funnel({ form: workshop });
  const { calls, crm } = fakeCrm();
  const r = await submitForm(raw(page.id), { clientIp: "1.2.3.4", crm });
  assert.equal(r.kind, "ok");
  assert.match(calls[0].formName ?? "", /AI Workshop/);
  assert.equal(calls[0].createDeal, true);
  assert.equal(calls[0].preferredLanguage, "zh");
  assert.equal(calls[0].attribution?.utmId, "u1");
  assert.equal(calls[0].attribution?.utmAdId, "a1");
  assert.equal(calls[0].attribution?.utmSource, "fb");
});

it("form name in the request body is ignored", async () => {
  const { page } = await funnel({ form: interest });
  const { calls, crm } = fakeCrm();
  await submitForm({ ...raw(page.id), formName: "Evil", createDeal: false, message: "hi" } as FormRaw, { clientIp: null, crm });
  assert.equal(calls[0].formName, "My form");
  assert.equal(calls[0].createDeal, true);
  assert.equal(calls[0].message, undefined); // not a field of this form
});

it("same idempotency key twice reaches the CRM with the same key and both answer ok", async () => {
  const { page } = await funnel({ form: interest, capi: true });
  const { calls, crm } = fakeCrm();
  const r = raw(page.id);
  assert.equal((await submitForm(r, { clientIp: null, crm })).kind, "ok");
  assert.equal((await submitForm(r, { clientIp: null, crm })).kind, "ok");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotencyKey, r.idempotencyKey);
  assert.equal(calls[1].idempotencyKey, r.idempotencyKey);
  const [{ n }] = await db()`SELECT count(*)::int n FROM sales.capi_event WHERE event_id = ${`lead:${r.idempotencyKey}`}`;
  assert.equal(n, 1);
});

it("a draft page refuses submissions", async () => {
  const { page } = await funnel({ form: interest, publish: false });
  const { calls, crm } = fakeCrm();
  assert.equal((await submitForm(raw(page.id), { clientIp: null, crm })).kind, "not_found");
  assert.equal(calls.length, 0);
});

it("CRM error answers with the WhatsApp link and logs no personal data", async () => {
  const { page } = await funnel({ form: interest, whatsapp: "+60 12-345 6789".replace(/[ -]/g, "") });
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    const r = await submitForm(raw(page.id), { clientIp: null, crm: async () => ({ kind: "error" }) });
    assert.deepEqual(r, { kind: "error", whatsapp: "https://wa.me/60123456789" });
  } finally {
    console.error = orig;
  }
  assert.ok(!logged.join("\n").includes("ann@example.com"));
});

it("landing url host and path are ours; only the query comes from the body", async () => {
  const { page } = await funnel({ form: interest, capi: true });
  const { calls, crm } = fakeCrm();
  const r = raw(page.id, { landingUrl: "https://evil.com/other-step?utm_source=x" });
  await submitForm(r, { clientIp: null, crm });
  const want = `https://ai.thelead.io${page.path}?utm_source=x`;
  assert.equal(calls[0].attribution?.landingUrl, want);
  const [e] = await db()`SELECT payload FROM sales.capi_event WHERE event_id = ${`lead:${r.idempotencyKey}`}`;
  assert.equal(e.payload.event_source_url, want);
});

it("a bad idempotency key is invalid and never reaches the CRM", async () => {
  const { page } = await funnel({ form: interest });
  const { calls, crm } = fakeCrm();
  for (const k of ["short", "has space here", "x".repeat(101)]) {
    const r = await submitForm(raw(page.id, { idempotencyKey: k }), { clientIp: null, crm });
    assert.equal(r.kind, "invalid");
  }
  assert.equal(calls.length, 0);
});

it("readCapped refuses bodies over the cap", async () => {
  const mk = (b: string) => new Request("https://ai.thelead.io/api/site/form", { method: "POST", body: b });
  assert.equal(await readCapped(mk("{}"), 16), "{}");
  assert.equal(await readCapped(mk("x".repeat(17)), 16), null);
});
