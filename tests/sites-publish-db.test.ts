// lib/sites/publish: checks, route moves, history, restore, cross-site paths.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getSite, updateSiteSettings } from "../lib/sites/admin.ts";
import { listVersions, publishPage, restoreVersion, setPurgeFetch, unpublishPage } from "../lib/sites/publish.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const settings = { pixels: {}, capi: false, paymentMode: "test" as const, seo: {}, privacyUrl: "https://example.com/privacy" };
const form = (date: string) => {
  const s = JSON.stringify({
    type: "workshop",
    workshop: { title: "AI", date, language: "en" },
    fields: [],
    createDeal: true,
    after: { kind: "message", text: "ok" },
  });
  return `<div data-lead="form" data-settings='${s}'></div>`;
};

async function setup(withPrivacy = true, html = "<p>hi</p>") {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: `/t-${crypto.randomUUID().slice(0, 8)}` });
  let s = (await getSite(m, siteId))!;
  if (withPrivacy) await updateSiteSettings(m, siteId, settings, s.version);
  s = (await getSite(m, siteId))!;
  const page = s.steps[0];
  await db()`UPDATE sales.page_version SET html = ${html} WHERE page_id = ${page.id} AND status = 'draft'`;
  return { m, s, page };
}

it("publish refuses without privacy link", async () => {
  const { m, page } = await setup(false);
  const r = await publishPage(m, page.id, page.version);
  assert.equal(r.kind, "refused");
});

it("publish refuses a past workshop date", async () => {
  const { m, page } = await setup(true, form("2020-01-01"));
  const r = await publishPage(m, page.id, page.version);
  assert.equal(r.kind, "refused");
  assert.match((r as { reasons: string[] }).reasons.join(), /past/);
});

it("publish moves the route and archives the previous version", async () => {
  const purged: string[] = [];
  process.env.NETLIFY_PURGE_TOKEN = "t";
  process.env.NETLIFY_SITE_ID = "s";
  setPurgeFetch((async (_u: unknown, init: { body: string }) => {
    purged.push(init.body);
    return new Response("{}");
  }) as never);
  const { m, s, page } = await setup();
  assert.equal((await publishPage(m, page.id, page.version)).kind, "ok");
  const p2 = (await getSite(m, s.id))!.steps[0];
  assert.equal((await publishPage(m, page.id, p2.version)).kind, "ok");
  const vs = await listVersions(m, page.id);
  assert.deepEqual(vs.map((v) => v.status).sort(), ["archived", "published"]);
  const [r] = await db()`
    SELECT r.page_id, p.active_version_id FROM sales.site_route r JOIN sales.site_page p ON p.id = r.page_id
    WHERE r.domain = ${s.domain} AND r.path = ${page.path}`;
  assert.equal(r.page_id, page.id);
  assert.equal(r.active_version_id, vs.find((v) => v.status === "published")!.id);
  assert.equal((await publishPage(m, page.id, page.version)).kind, "conflict");
  assert.equal(purged.length, 2);
  assert.match(purged[0], new RegExp(`page:${page.id}`));
  delete process.env.NETLIFY_PURGE_TOKEN;
  await unpublishPage(m, page.id);
  const [h] = await db()`SELECT page_id FROM sales.site_route WHERE domain = ${s.domain} AND path = ${page.path}`;
  assert.equal(h.page_id, null);
});

it("restore brings back an archived version as live", async () => {
  const { m, s, page } = await setup(true, "<p>one</p>");
  await publishPage(m, page.id, page.version);
  await db()`UPDATE sales.page_version SET html = '<p>two</p>' WHERE page_id = ${page.id} AND status = 'draft'`;
  await publishPage(m, page.id, (await getSite(m, s.id))!.steps[0].version);
  const old = (await listVersions(m, page.id)).find((v) => v.status === "archived")!;
  assert.equal((await restoreVersion(m, page.id, old.id)).kind, "ok");
  const [live] = await db()`
    SELECT v.html FROM sales.site_page p JOIN sales.page_version v ON v.id = p.active_version_id WHERE p.id = ${page.id}`;
  assert.match(live.html, /one/);
});

it("publishing a path another site owns is refused", async () => {
  const a = await setup();
  await publishPage(a.m, a.page.id, a.page.version);
  const b = await setup();
  await db()`UPDATE sales.site_page SET path = ${a.page.path} WHERE id = ${b.page.id}`;
  const r = await publishPage(b.m, b.page.id, b.page.version);
  assert.equal(r.kind, "refused");
  assert.match((r as { reasons: string[] }).reasons.join(), /another site/);
});
