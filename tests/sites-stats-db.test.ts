// lib/sites/stats: view counting, and per-step opt-ins and revenue.
import { after } from "node:test";
import assert from "node:assert/strict";
import { SitesPermissionError } from "../lib/sites/admin.ts";
import { checkView, clientIp, klDay, recordView, resetViewWarnings, siteStats } from "../lib/sites/stats.ts";
import { closeDb } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";
import { buyer, liveFunnel } from "./sites-seed.ts";

after(closeDb);

it("two views by one visitor on one day = 2 views, 1 unique", async () => {
  process.env.PAGE_VIEW_SALT = "x".repeat(20);
  const { m, siteId, steps } = await liveFunnel({ formName: `F ${crypto.randomUUID()}` });
  const now = new Date();
  const v = crypto.randomUUID();
  await recordView(steps[0].id, "A", v, now);
  await recordView(steps[0].id, "A", v, now);
  await recordView(steps[0].id, "A", crypto.randomUUID(), now);
  const day = klDay(now);
  const [s0] = await siteStats(m, siteId, day, day);
  assert.equal(s0.views, 3);
  assert.equal(s0.uniques, 2);
});

it("a missing or short salt records nothing", async () => {
  process.env.PAGE_VIEW_SALT = "short";
  const { m, siteId, steps } = await liveFunnel({ formName: `F ${crypto.randomUUID()}` });
  await recordView(steps[0].id, "A", crypto.randomUUID(), new Date());
  const day = klDay(new Date());
  assert.equal((await siteStats(m, siteId, day, day))[0].views, 0);
});

it("stats count opt-ins and revenue for the step that produced them", async () => {
  const formName = `F ${crypto.randomUUID()}`;
  const { m, siteId, steps } = await liveFunnel({ formName });
  await buyer(steps[0].path, formName, "1800.00");
  await buyer(steps[0].path, formName, "1000.00", "300.00"); // net 700
  await buyer(steps[0].path, formName, "500.00", "0", false); // no source_touchpoint_id: found by the 2 minute web_form rule
  await buyer(steps[1].path, "Some other form", "999.00"); // other step
  const day = klDay(new Date());
  const [a, b] = await siteStats(m, siteId, day, day);
  assert.equal(a.optins, 3);
  assert.equal(a.orders, 3);
  assert.equal(a.revenueMyr, 3000);
  assert.equal(a.avgOrderMyr, 1000);
  assert.equal(b.optins, 0); // that form name is not one of the site's
  assert.equal(b.orders, 1);
  assert.equal(b.revenueMyr, 999);
  const yesterday = klDay(new Date(Date.now() - 2 * 86_400_000));
  assert.equal((await siteStats(m, siteId, yesterday, yesterday))[0].optins, 0);
});

it("a viewer without site access is refused", async () => {
  const { siteId } = await liveFunnel({ formName: "x" });
  const nobody = await newUser("support");
  await assert.rejects(siteStats(nobody, siteId, "2026-01-01", "2026-01-02"), SitesPermissionError);
});

const ORIGIN = "https://ai.thelead.io";
const req = (over: Record<string, unknown>) => ({
  host: "ai.thelead.io", origin: ORIGIN, referer: null, ip: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.1`,
  pageId: "", variant: "A", ...over,
});

it("checkView: host, origin, variant, salt and page gates", async () => {
  process.env.PAGE_VIEW_SALT = "x".repeat(20);
  process.env.RATE_LIMIT_SECRET = "s".repeat(20);
  const { steps } = await liveFunnel({ formName: "x" });
  const pageId = steps[0].id;
  assert.equal((await checkView(req({ pageId }))).kind, "ok");
  assert.equal((await checkView(req({ pageId, host: "app.example.com" }))).kind, "notfound");
  assert.equal((await checkView(req({ pageId, origin: "https://evil.example" }))).kind, "forbidden");
  assert.equal((await checkView(req({ pageId, origin: null }))).kind, "forbidden");
  assert.equal((await checkView(req({ pageId, origin: null, referer: `${ORIGIN}/x/y` }))).kind, "ok");
  assert.equal((await checkView(req({ pageId, variant: "Z" }))).kind, "bad");
  assert.equal((await checkView(req({ pageId, variant: "a b" }))).kind, "bad");
  assert.equal((await checkView(req({ pageId: "nope" }))).kind, "bad");
  assert.equal((await checkView(req({ pageId: crypto.randomUUID() }))).kind, "notfound");
  // unpublished step (never published): not found
  assert.equal((await checkView(req({ pageId: steps[1].id }))).kind, "notfound");
  process.env.PAGE_VIEW_SALT = "short";
  assert.equal((await checkView(req({ pageId }))).kind, "off");
});

it("checkView: 60 per minute per IP, then limited; another IP is unaffected", async () => {
  process.env.PAGE_VIEW_SALT = "x".repeat(20);
  process.env.RATE_LIMIT_SECRET = "s".repeat(20);
  const { steps } = await liveFunnel({ formName: "x" });
  const ip = `192.0.2.${Math.floor(Math.random() * 250)}`;
  const bucketKey = crypto.randomUUID(); // keep this IP's bucket unique to the run
  const r = (i: string) => req({ pageId: steps[0].id, ip: `${i}-${bucketKey}` });
  for (let i = 0; i < 60; i++) assert.equal((await checkView(r(ip))).kind, "ok");
  assert.equal((await checkView(r(ip))).kind, "limited");
  assert.equal((await checkView(r(ip + "x"))).kind, "ok");
  delete process.env.RATE_LIMIT_SECRET;
  assert.equal((await checkView(r(ip + "y"))).kind, "limited");
});

it("missing salt / rate-limit secret fail closed and log once per process", async () => {
  const { steps } = await liveFunnel({ formName: "x" });
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    resetViewWarnings();
    process.env.RATE_LIMIT_SECRET = "short";
    process.env.PAGE_VIEW_SALT = "x".repeat(20);
    for (let i = 0; i < 3; i++) assert.equal((await checkView(req({ pageId: steps[0].id }))).kind, "limited");
    process.env.PAGE_VIEW_SALT = "";
    for (let i = 0; i < 3; i++) assert.equal((await checkView(req({ pageId: steps[0].id }))).kind, "off");
  } finally {
    console.error = orig;
  }
  assert.deepEqual(logged, ["site-view: RATE_LIMIT_SECRET not configured", "site-view: PAGE_VIEW_SALT not configured"]);
});

it("clientIp prefers the Netlify header, then the first x-forwarded-for", async () => {
  assert.equal(clientIp(new Headers({ "x-nf-client-connection-ip": " 1.1.1.1 ", "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "1.1.1.1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "2.2.2.2");
  assert.equal(clientIp(new Headers()), null);
});
