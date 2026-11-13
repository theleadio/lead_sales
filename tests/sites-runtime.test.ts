import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST, LAST, buildPayload, checkoutSuccess, cookieValue, cookiesToWrite, failure, formSuccess, parseSettings, t,
} from "../lib/sites/runtime-core.ts";
import { COPY } from "../lib/sites/runtime-copy.ts";

const NOW = new Date("2026-11-13T00:00:00Z");
const H = "https://ai.thelead.io/x?utm_source=fb&utm_campaign=c";

test("no cookies without UTM or click id", () => {
  assert.deepEqual(cookiesToWrite(null, "https://ai.thelead.io/x?ref=1", null, NOW), []);
});

test("campaign arrival writes both cookies with the CRM attributes", () => {
  const [f, l] = cookiesToWrite(null, H, "https://google.com/", NOW);
  assert.match(f, new RegExp(`^${FIRST}=`));
  assert.match(l, new RegExp(`^${LAST}=`));
  for (const c of [f, l]) for (const a of ["Path=/", "Max-Age=7776000", "SameSite=Lax", "Secure"]) assert.ok(c.includes(a), a);
  assert.ok(!f.includes("Domain"));
  const v = JSON.parse(decodeURIComponent(f.split(";")[0].split("=")[1]));
  assert.equal(v.utmSource, "fb");
  assert.equal(v.occurredAt, NOW.toISOString());
});

test("click id alone counts; http page gets no Secure", () => {
  const out = cookiesToWrite(null, "http://localhost/x?fbclid=abc", null, NOW);
  assert.equal(out.length, 2);
  assert.ok(!out[0].includes("Secure"));
});

test("first touch is kept, last is overwritten", () => {
  const existing = encodeURIComponent(JSON.stringify({ occurredAt: "2026-01-01T00:00:00Z" }));
  const out = cookiesToWrite(existing, H, null, NOW);
  assert.equal(out.length, 1);
  assert.match(out[0], new RegExp(`^${LAST}=`));
  // an unreadable first touch counts as none
  assert.equal(cookiesToWrite("%E0%A4%A", H, null, NOW).length, 2);
});

test("cookieValue reads one cookie", () => {
  assert.equal(cookieValue("a=1; lead_first_touch=x%20y; b=2", FIRST), "x%20y");
  assert.equal(cookieValue("a=1", FIRST), null);
});

test("settings parsing rejects malformed JSON and wrong shapes", () => {
  assert.equal(parseSettings("{nope", "form"), null);
  assert.equal(parseSettings(null, "form"), null);
  assert.equal(parseSettings("[]", "form"), null);
  assert.equal(parseSettings('{"fields":"company"}', "form"), null);
  assert.equal(parseSettings('{"askCompany":true}', "order"), null);
  assert.equal(parseSettings('{"classCode":"","askCompany":true}', "order"), null);
  assert.deepEqual(parseSettings('{"fields":["company","evil","message"]}', "form")?.fields, ["company", "message"]);
  assert.deepEqual(parseSettings('{"classCode":"C1","askCompany":true}', "order"), { fields: ["company"], askCompany: true, classCode: "C1" });
});

const ids = { pageId: "p", formId: "f", idempotencyKey: "k", landingUrl: "https://ai.thelead.io/x", referrer: "" };
const vals = { fullName: "A", email: "a@b.co", phone: "012", companyName: "Co", jobTitle: "J", message: "M" };

test("payload carries only the fields the settings allow", () => {
  const s = parseSettings('{"fields":["company"]}', "form")!;
  const p = buildPayload(s, ids, vals, false);
  assert.deepEqual(p, { ...ids, fullName: "A", email: "a@b.co", phone: "012", consentMarketing: false, companyName: "Co" });
  const p2 = buildPayload(s, ids, vals, true, "tok");
  assert.equal(p2.captchaToken, "tok");
  assert.equal(p2.consentMarketing, true);
  assert.ok(!("jobTitle" in p) && !("message" in p));
});

test("error and success outcomes map to copy", () => {
  assert.equal((failure("en", 429, {}) as any).text, "Too many tries — please try again in a few minutes");
  const u = failure("en", 502, { error: "unavailable", whatsapp: "https://wa.me/6012" }) as any;
  assert.equal(u.text, "Something went wrong — please WhatsApp us");
  assert.equal(u.whatsapp, "https://wa.me/6012");
  assert.equal((failure("en", 502, { whatsapp: "javascript:alert(1)" }) as any).whatsapp, undefined);
  const inv = failure("zh", 400, { error: "invalid", fields: { email: "invalid" } }) as any;
  assert.deepEqual(Object.keys(inv.fields), ["email"]);
  assert.equal(inv.fields.email, COPY.zh.invalid);
  assert.equal((failure("en", 400, { error: "captcha" }) as any).text, COPY.en.captcha);
  assert.equal((failure("en", 0, {}) as any).text, COPY.en.unavailable);
  assert.equal(t("en", "full"), "This class is full");
  assert.equal(t("en", "already_enrolled"), "You're already registered for this class.");
  assert.equal(t("en", "hrdc_contact"), "Thanks — our team will contact your company about HRDC.");
  assert.equal(Object.keys(COPY.en).sort().join(), Object.keys(COPY.zh).sort().join());
});

test("form success: message, https url, step falls back to thank-you", () => {
  assert.deepEqual(formSuccess("en", { after: { kind: "message", text: "Hi" } }), { kind: "text", ok: true, text: "Hi" });
  assert.deepEqual(formSuccess("en", { after: { kind: "url", url: "https://x.co/a" } }), { kind: "go", url: "https://x.co/a" });
  assert.equal((formSuccess("en", { after: { kind: "url", url: "javascript:1" } }) as any).text, "Thank you! We'll be in touch.");
  assert.equal((formSuccess("en", { after: { kind: "step", pageId: "z" } }) as any).text, "Thank you! We'll be in touch.");
  assert.deepEqual(formSuccess("en", { after: { kind: "step", path: "/f/thank-you" } }), { kind: "go", url: "/f/thank-you" });
  for (const path of ["//evil.com", "https://evil.com", "/\\evil.com", "/\t/evil.com", "/a\nb", "/a b", "x"]) {
    assert.equal(formSuccess("en", { after: { kind: "step", path } }).kind, "text");
  }
});

test("checkout redirects only to checkout.stripe.com", () => {
  assert.deepEqual(checkoutSuccess("en", { redirect: "https://checkout.stripe.com/c/pay/x" }), { kind: "go", url: "https://checkout.stripe.com/c/pay/x" });
  for (const bad of ["https://checkout.stripe.com.evil.co/x", "http://checkout.stripe.com/x", "https://evil.co/"]) {
    assert.equal(checkoutSuccess("en", { redirect: bad }).kind, "text");
  }
  assert.equal((checkoutSuccess("en", { result: "full" }) as any).text, "This class is full");
  assert.equal((checkoutSuccess("zh", { result: "already_enrolled" }) as any).text, COPY.zh.already_enrolled);
});
