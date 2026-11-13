// lib/sites/capi: queueing (hashing, dedupe), draining (retry, failure), Purchase scan.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { drainCapi, queueCapi } from "../lib/sites/capi.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it } from "./seed.ts";
import { buyer, liveFunnel } from "./sites-seed.ts";

after(closeDb);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ev = (over = {}) => ({
  eventId: `t:${crypto.randomUUID()}`,
  eventTime: new Date(),
  sourceUrl: "https://ai.thelead.io/x",
  consent: false,
  ...over,
});
const row = async (eventId: string) =>
  (await db()`SELECT payload, status, attempts, last_error, next_attempt_at FROM sales.capi_event WHERE event_id = ${eventId}`)[0];
const env = () => {
  process.env.META_CAPI_TOKEN = "tok-secret";
  process.env.META_PIXEL_ID = "12345";
  delete process.env.META_TEST_EVENT_CODE;
};

it("Lead without consent sends no email/phone hash; with consent, normalised hashes", async () => {
  const a = ev({ email: "A@B.com", phone: "+60 12-345 6789" });
  await queueCapi("Lead", a);
  assert.deepEqual((await row(a.eventId)).payload.user_data, {});
  const b = ev({ email: " A@B.com ", phone: "+60 12-345 6789", consent: true, fbc: "fb.1.1.x" });
  await queueCapi("Lead", b);
  const u = (await row(b.eventId)).payload.user_data;
  assert.deepEqual(u.em, [sha("a@b.com")]);
  assert.deepEqual(u.ph, [sha("60123456789")]);
  assert.equal(u.fbc, "fb.1.1.x");
  assert.ok(!JSON.stringify((await row(b.eventId)).payload).includes("a@b.com"));
});

it("same event_id is queued once", async () => {
  const e = ev();
  await queueCapi("PageView", e);
  await queueCapi("PageView", e);
  const [{ n }] = await db()`SELECT count(*)::int n FROM sales.capi_event WHERE event_id = ${e.eventId}`;
  assert.equal(n, 1);
});

it("a 500 from Meta retries later, a 400 fails after logging the status only", async () => {
  env();
  const e = ev({ clientIp: "1.2.3.4" });
  await queueCapi("PageView", e);
  const now = new Date(Date.now() + 1000);
  let url = "";
  let body: { data: { event_id: string }[]; test_event_code?: string } = { data: [] };
  const respond = (status: number) => async (u: string | URL | Request, init?: RequestInit) => {
    url = String(u);
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status });
  };
  process.env.META_TEST_EVENT_CODE = "TEST1";
  const r500 = await drainCapi(now, respond(500) as typeof fetch);
  assert.deepEqual(r500, { sent: 0, failed: 0 });
  assert.match(url, /^https:\/\/graph\.facebook\.com\/v21\.0\/12345\/events\?access_token=tok-secret$/);
  assert.equal(body.test_event_code, "TEST1");
  assert.ok(body.data.some((d) => d.event_id === e.eventId));
  let r = await row(e.eventId);
  assert.equal(r.status, "queued");
  assert.equal(r.attempts, 1);
  assert.equal(r.last_error, "HTTP 500");
  assert.equal(r.next_attempt_at.getTime(), now.getTime() + 60_000);
  // Not due yet: nothing is sent for it.
  await drainCapi(now, respond(500) as typeof fetch);
  assert.equal((await row(e.eventId)).attempts, 1);

  const later = new Date(now.getTime() + 2 * 60_000);
  const r400 = await drainCapi(later, respond(400) as typeof fetch);
  assert.ok(r400.failed >= 1);
  r = await row(e.eventId);
  assert.equal(r.status, "failed");
  assert.equal(r.last_error, "HTTP 400");
  assert.ok(!JSON.stringify(r).includes("tok-secret"));
});

it("a 200 marks events sent; a thrown fetch retries", async () => {
  env();
  const e = ev();
  await queueCapi("PageView", e);
  const now = new Date(Date.now() + 1000);
  await drainCapi(now, (async () => { throw new Error("boom tok-secret"); }) as typeof fetch);
  assert.equal((await row(e.eventId)).last_error, "network error");
  const r = await drainCapi(new Date(now.getTime() + 2 * 60_000), (async () => new Response("{}", { status: 200 })) as typeof fetch);
  assert.ok(r.sent >= 1);
  assert.equal((await row(e.eventId)).status, "sent");
});

it("drain queues one Purchase per attributed payment, net of refunds, once", async () => {
  env();
  const formName = `F ${crypto.randomUUID()}`;
  const { steps } = await liveFunnel({ formName, capi: true });
  const { paymentId } = await buyer(steps[0].path, formName, "1000.00", "250.00");
  const off = await liveFunnel({ formName: `G ${crypto.randomUUID()}`, capi: false });
  const { paymentId: skipped } = await buyer(off.steps[0].path, "x", "100.00");
  const ok = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  const now = new Date(Date.now() + 1000);
  await drainCapi(now, ok);
  await drainCapi(new Date(now.getTime() + 60_000), ok);
  const p = await row(`purchase:${paymentId}`);
  assert.equal(p.payload.event_name, "Purchase");
  assert.deepEqual(p.payload.custom_data, { currency: "MYR", value: 750 });
  assert.match(p.payload.user_data.fbc, /^fb\.1\.\d+\.abc$/);
  assert.equal(p.status, "sent");
  assert.equal(await row(`purchase:${skipped}`), undefined);
  const [{ n }] = await db()`SELECT count(*)::int n FROM sales.capi_event WHERE event_id = ${`purchase:${paymentId}`}`;
  assert.equal(n, 1);
});
