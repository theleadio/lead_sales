import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { crmLead, crmRegister, setCrmFetch } from "../lib/sites/crm-api.ts";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: unknown) => {
  setCrmFetch((async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch);
};
const err = (code: string, extra: object = {}) => ({ error: { code, message: "x", ...extra } });

beforeEach(() => {
  calls = [];
  process.env.CRM_BASE_URL = "https://crm.test/";
  process.env.PUBLIC_API_KEY = "k-secret";
});

const lead = { fullName: "Ali", email: "a@b.my", createDeal: false, attribution: { utmId: "1", utmAdId: "2" } };
const none = { clientIp: null };

test("lead: URL, headers, body; 201 -> ok", async () => {
  reply(201, { ok: true, personId: "p1", dealId: null });
  const r = await crmLead(lead, { clientIp: "1.2.3.4" });
  assert.deepEqual(r, { kind: "ok", personId: "p1", dealId: null });
  assert.equal(calls[0].url, "https://crm.test/api/public/leads");
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h["X-Api-Key"], "k-secret");
  assert.equal(h["X-Lead-Client-Ip"], "1.2.3.4");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), lead);
  assert.ok(calls[0].init.signal);
});

test("no client ip -> header omitted", async () => {
  reply(201, { personId: "p", dealId: "d" });
  await crmLead(lead, none);
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Lead-Client-Ip"], undefined);
});

test("400 validation_failed -> invalid with fields", async () => {
  reply(400, err("validation_failed", { fields: { email: "Enter a valid email" } }));
  assert.deepEqual(await crmLead(lead, none), { kind: "invalid", fields: { email: "Enter a valid email" } });
});

test("429 -> limited; 403 captcha_failed -> captcha", async () => {
  reply(429, err("rate_limited"));
  assert.deepEqual(await crmLead(lead, none), { kind: "limited" });
  reply(403, err("captcha_failed"));
  assert.deepEqual(await crmLead(lead, none), { kind: "captcha" });
});

test("other failures -> error (401, other 403, 500, bad json, network, unconfigured)", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    for (const [s, c] of [[401, "unauthorized"], [403, "origin_not_allowed"], [500, "server_error"], [503, "not_configured"]] as const) {
      reply(s, err(c));
      assert.deepEqual(await crmLead(lead, none), { kind: "error" }, String(s));
    }
    setCrmFetch((async () => new Response("<html>", { status: 502 })) as typeof fetch);
    assert.deepEqual(await crmLead(lead, none), { kind: "error" });
    setCrmFetch((async () => {
      throw new DOMException("t", "TimeoutError");
    }) as typeof fetch);
    assert.deepEqual(await crmLead(lead, none), { kind: "error" });
    delete process.env.PUBLIC_API_KEY;
    assert.deepEqual(await crmLead(lead, none), { kind: "error" });
  } finally {
    console.error = orig;
  }
});

test("errors never log the key, body or personal data", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    reply(500, err("server_error", { fields: { email: "a@b.my" } }));
    await crmLead(lead, { clientIp: "1.2.3.4" });
  } finally {
    console.error = orig;
  }
  const out = logged.join("\n");
  assert.ok(out.length > 0);
  assert.ok(!/a@b\.my|Ali|k-secret|1\.2\.3\.4/.test(out), out);
});

const reg = { fullName: "Ali", phone: "0123456789", classCode: "AIA-2611-EN", returnUrl: "https://ai.thelead.io/x" };

test("register: 201 checkout -> url; posts to /register", async () => {
  reply(201, { ok: true, next: "checkout", checkoutUrl: "https://stripe.test/s", personId: "p", dealId: "d" });
  assert.deepEqual(await crmRegister(reg, none), { kind: "checkout", url: "https://stripe.test/s" });
  assert.equal(calls[0].url, "https://crm.test/api/public/register");
  assert.equal(JSON.parse(calls[0].init.body as string).returnUrl, reg.returnUrl);
});

test("register: 409 no_seats -> full, class_unavailable -> closed", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    reply(409, err("no_seats"));
    assert.deepEqual(await crmRegister(reg, none), { kind: "full" });
    reply(409, err("class_unavailable"));
    assert.deepEqual(await crmRegister(reg, none), { kind: "closed" });
  } finally {
    console.error = orig;
  }
});

test("register: 409 already_enrolled -> already_enrolled", async () => {
  reply(409, err("already_enrolled"));
  assert.deepEqual(await crmRegister(reg, none), { kind: "already_enrolled" });
});

test("register: 201 hrdc_contact -> hrdc_contact", async () => {
  reply(201, { ok: true, next: "hrdc_contact", personId: "p", dealId: "d" });
  assert.deepEqual(await crmRegister(reg, none), { kind: "hrdc_contact" });
});

test("utmId/utmAdId reach the request body unchanged, on both routes", async () => {
  const attribution = { utmSource: "fb", utmId: "123", utmAdId: "456" };
  reply(201, { personId: "p", dealId: null });
  await crmLead({ fullName: "A", email: "a@b.my", attribution }, none);
  reply(201, { next: "hrdc_contact" });
  await crmRegister({ ...reg, attribution }, none);
  for (const c of calls) assert.deepEqual(JSON.parse(c.init.body as string).attribution, attribution);
});

test("register: 400/429/403 map as for leads", async () => {
  reply(400, err("validation_failed", { fields: { classCode: "Choose a class" } }));
  assert.deepEqual(await crmRegister(reg, none), { kind: "invalid", fields: { classCode: "Choose a class" } });
  reply(429, err("rate_limited"));
  assert.deepEqual(await crmRegister(reg, none), { kind: "limited" });
  reply(403, err("captcha_failed"));
  assert.deepEqual(await crmRegister(reg, none), { kind: "captcha" });
});
