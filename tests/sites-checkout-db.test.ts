// lib/sites/checkout: the order form endpoint's logic, with a fake CRM.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getSite, updateSiteSettings } from "../lib/sites/admin.ts";
import { submitOrder, type OrderRaw } from "../lib/sites/checkout.ts";
import { publishPage } from "../lib/sites/publish.ts";
import type { CrmRegisterInput, CrmRegisterResult } from "../lib/sites/crm-api.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const ORDER_ID = "order-1";
const esc = (o: unknown) => JSON.stringify(o).replace(/"/g, "&quot;");

async function funnel(order: unknown = { classCode: "AI-2026-12", askCompany: true }) {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: `/t-${crypto.randomUUID().slice(0, 8)}` });
  let s = (await getSite(m, siteId))!;
  await updateSiteSettings(
    m,
    siteId,
    { pixels: {}, capi: false, paymentMode: "test", seo: {}, privacyUrl: "https://example.com/privacy" },
    s.version,
  );
  s = (await getSite(m, siteId))!;
  const [home, pay, thanks] = s.steps;
  const html = `<div data-lead="order" data-id="${ORDER_ID}" data-settings="${esc(order)}"></div>`;
  await db()`UPDATE sales.page_version SET html = ${html} WHERE page_id = ${pay.id} AND status = 'draft'`;
  assert.equal((await publishPage(m, pay.id, pay.version)).kind, "ok");
  return { pay, thanks, home };
}

const raw = (pageId: string, over: Partial<OrderRaw> = {}): OrderRaw => ({
  pageId,
  formId: ORDER_ID,
  fullName: "Ann Lee",
  email: "ann@example.com",
  phone: "0123456789",
  consentMarketing: true,
  idempotencyKey: crypto.randomUUID(),
  landingUrl: "https://ai.thelead.io/x?utm_id=u1",
  referrer: null,
  ...over,
});

const fakeCrm = (result: CrmRegisterResult = { kind: "checkout", url: "https://checkout.stripe.com/c/1" }) => {
  const calls: CrmRegisterInput[] = [];
  return { calls, crm: async (i: CrmRegisterInput) => (calls.push(i), result) };
};

it("order sends classCode from the published page and the funnel's thank-you returnUrl", async () => {
  const { pay, thanks } = await funnel();
  const { calls, crm } = fakeCrm();
  const r = await submitOrder(raw(pay.id), { clientIp: "1.2.3.4", crm });
  assert.deepEqual(r, { kind: "redirect", url: "https://checkout.stripe.com/c/1" });
  assert.equal(calls[0].classCode, "AI-2026-12");
  assert.equal(calls[0].returnUrl, `https://ai.thelead.io${thanks.path}`);
  assert.equal(calls[0].attribution?.utmId, "u1");
});

it("CRM full answer shows full and no redirect", async () => {
  const { pay } = await funnel();
  assert.deepEqual(await submitOrder(raw(pay.id), { clientIp: null, crm: fakeCrm({ kind: "full" }).crm }), { kind: "full" });
});

it("closed class, already enrolled and HRDC pass through", async () => {
  const { pay } = await funnel();
  for (const kind of ["closed", "already_enrolled", "hrdc_contact"] as const) {
    assert.deepEqual(await submitOrder(raw(pay.id), { clientIp: null, crm: fakeCrm({ kind }).crm }), { kind });
  }
});

it("class code in the request body is ignored", async () => {
  const { pay } = await funnel();
  const { calls, crm } = fakeCrm();
  await submitOrder({ ...raw(pay.id), classCode: "EVIL", returnUrl: "https://evil.example" } as OrderRaw, { clientIp: null, crm });
  assert.equal(calls[0].classCode, "AI-2026-12");
  assert.match(calls[0].returnUrl ?? "", /^https:\/\/ai\.thelead\.io\//);
});

it("company is sent only when the form asks for it", async () => {
  const { pay } = await funnel({ classCode: "C1", askCompany: false });
  const { calls, crm } = fakeCrm();
  await submitOrder(raw(pay.id, { companyName: "Acme" }), { clientIp: null, crm });
  assert.equal(calls[0].companyName, undefined);
});

it("a page that is not the checkout step, or an unknown form, is not found", async () => {
  const { pay, home } = await funnel();
  const { crm } = fakeCrm();
  assert.deepEqual(await submitOrder(raw(home.id), { clientIp: null, crm }), { kind: "not_found" });
  assert.deepEqual(await submitOrder(raw(pay.id, { formId: "nope" }), { clientIp: null, crm }), { kind: "not_found" });
});

it("CRM error returns the error kind", async () => {
  const { pay } = await funnel();
  const r = await submitOrder(raw(pay.id), { clientIp: null, crm: fakeCrm({ kind: "error" }).crm });
  assert.equal(r.kind, "error");
});
