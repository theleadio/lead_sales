// lib/sites/stats: view counting, and per-step opt-ins and revenue.
import { after } from "node:test";
import assert from "node:assert/strict";
import { SitesPermissionError } from "../lib/sites/admin.ts";
import { klDay, recordView, siteStats } from "../lib/sites/stats.ts";
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
