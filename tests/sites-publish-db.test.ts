// lib/sites/publish: checks, route moves, history, restore, cross-site paths.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getSite, SitesPermissionError, updateSiteSettings } from "../lib/sites/admin.ts";
import {
  listVersions,
  publishPage,
  publishSite,
  restoreVersion,
  setPurgeFetch,
  setRedirect,
  unpublishPage,
  writeRoute,
} from "../lib/sites/publish.ts";
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
  const cur = (await getSite(m, s.id))!.steps[0].version;
  assert.equal((await restoreVersion(m, page.id, old.id, cur - 1)).kind, "conflict");
  assert.equal((await restoreVersion(m, page.id, old.id, cur)).kind, "ok");
  const [au] = await db()`
    SELECT after FROM audit_log WHERE entity = 'site_page' AND entity_id = ${page.id} AND after ? 'restoredFrom'`;
  assert.equal(au.after.restoredFrom, old.id);
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

const audits = (entity: string, id: string) =>
  db()`SELECT action, before, after FROM audit_log WHERE entity = ${entity} AND entity_id = ${id} ORDER BY at`;

it("sales cannot publish; the refusal is audited", async () => {
  const { page } = await setup();
  const sales = await newUser("sales");
  await assert.rejects(publishPage(sales, page.id, page.version), SitesPermissionError);
  const [n] = await db()`SELECT count(*)::int AS n FROM audit_log WHERE user_id = ${sales.id} AND action = 'permission_denied'`;
  assert.equal(n.n, 1);
});

it("publish and unpublish are audited", async () => {
  const { m, page } = await setup();
  await publishPage(m, page.id, page.version);
  await unpublishPage(m, page.id);
  const rows = await audits("site_page", page.id);
  assert.deepEqual(rows.map((r) => r.after.what), ["publish", "unpublish"]);
});

it("publishSite is all-or-nothing and writes a site audit row", async () => {
  const { m, s } = await setup(true, "<p>ok</p>");
  const bad = s.steps[1];
  await db()`UPDATE sales.page_version SET html = ${'<div data-lead="order" data-settings="{}"></div>'} WHERE page_id = ${bad.id} AND status = 'draft'`;
  const r = await publishSite(m, s.id);
  assert.equal(r.kind, "refused");
  const [n] = await db()`SELECT count(*)::int AS n FROM sales.page_version WHERE page_id = ${s.steps[0].id} AND status = 'published'`;
  assert.equal(n.n, 0);
  await db()`UPDATE sales.page_version SET html = '<p>fine</p>' WHERE page_id = ${bad.id} AND status = 'draft'`;
  assert.equal((await publishSite(m, s.id)).kind, "ok");
  const [a] = await audits("site", s.id).then((x) => x.filter((y) => y.after?.what === "publish"));
  assert.equal(a.after.pageIds.length, 3);
});

it("an order form without a class is refused", async () => {
  const o = `<div data-lead="order" data-settings='{"classCode":"","askCompany":false}'></div>`;
  const { m, page } = await setup(true, o);
  assert.equal((await publishPage(m, page.id, page.version)).kind, "refused");
});

it("form checks ignore quote and spacing style in the raw HTML", async () => {
  const s = JSON.stringify({ type: "enquiry", fields: [], createDeal: false, after: { kind: "message", text: "x" } });
  const ok = `<div class = 'x'  data-lead = "form"   data-settings = '${s}' ></div>`;
  const { m, page } = await setup(true, ok);
  assert.equal((await publishPage(m, page.id, page.version)).kind, "ok");
  const bad = await setup(true, '<div  data-lead="form" data-settings = "{}" ></div>');
  assert.equal((await publishPage(bad.m, bad.page.id, bad.page.version)).kind, "refused");
});

it("a global section is inlined and cleaned; a missing one refuses", async () => {
  const m = await newUser("marketing");
  const [g] = await db()`
    INSERT INTO sales.global_section (name, html, css) VALUES ('Footer', '<p>foot</p><script>alert(1)</script>', '.f{color:red}')
    RETURNING id`;
  const ph = (id: string) => `<div data-lead="global-section" data-id="${id}"></div>`;
  const { page, s } = await setup(true, ph(g.id));
  assert.equal((await publishPage(m, page.id, page.version)).kind, "ok");
  const [live] = await db()`SELECT v.html, v.css FROM sales.site_page p JOIN sales.page_version v ON v.id = p.active_version_id WHERE p.id = ${page.id}`;
  assert.match(live.html, /foot/);
  assert.doesNotMatch(live.html, /script|alert/);
  assert.match(live.css, /color:red/);
  const missing = crypto.randomUUID();
  await db()`UPDATE sales.page_version SET html = ${ph(missing)} WHERE page_id = ${s.steps[1].id} AND status = 'draft'`;
  const r = await publishPage(m, s.steps[1].id, s.steps[1].version);
  assert.equal(r.kind, "refused");
  assert.match((r as { reasons: string[] }).reasons.join(), new RegExp(missing));
});

it("the route write refuses atomically when another site owns the path", async () => {
  const a = await setup();
  await publishPage(a.m, a.page.id, a.page.version);
  const b = await setup();
  const w = await writeRoute(a.s.domain, { id: b.page.id, siteId: b.s.id, path: a.page.path }, b.page.id);
  assert.equal(w.ok, false);
  const [r] = await db()`SELECT page_id FROM sales.site_route WHERE domain = ${a.s.domain} AND path = ${a.page.path}`;
  assert.equal(r.page_id, a.page.id);
});

it("setRedirect stores a redirect, audits it, and publishing over it audits the old target", async () => {
  const { m, s, page } = await setup();
  await assert.rejects(setRedirect(m, s.domain, page.path, "javascript:x"), /https URL or a path/);
  await setRedirect(m, s.domain, page.path, "https://old.example.com/x");
  const [r] = await db()`SELECT page_id, redirect_to FROM sales.site_route WHERE domain = ${s.domain} AND path = ${page.path}`;
  assert.equal(r.redirect_to, "https://old.example.com/x");
  await publishPage(m, page.id, page.version);
  const rows = await audits("site_page", page.id);
  assert.equal(rows[0].before.replacedRedirect, "https://old.example.com/x");
  const [r2] = await db()`SELECT page_id, redirect_to FROM sales.site_route WHERE domain = ${s.domain} AND path = ${page.path}`;
  assert.equal(r2.redirect_to, null);
  assert.equal(r2.page_id, page.id);
  await assert.rejects(setRedirect(m, s.domain, page.path, "/elsewhere"), /live page/);
});

it("saving site settings purges every published page of the site, never fails the save", async () => {
  const bodies: string[] = [];
  process.env.NETLIFY_PURGE_TOKEN = "t";
  process.env.NETLIFY_SITE_ID = "s";
  setPurgeFetch((async (_u: unknown, init: { body: string }) => {
    bodies.push(init.body);
    return new Response("{}");
  }) as never);
  try {
    const { m, s, page } = await setup();
    assert.equal((await publishPage(m, page.id, page.version)).kind, "ok");
    bodies.length = 0;
    const v = (await getSite(m, s.id))!.version;
    assert.equal((await updateSiteSettings(m, s.id, { ...settings, pixels: { meta: "123456789" } }, v)).kind, "ok");
    assert.equal(bodies.length, 1); // only the published step
    assert.match(bodies[0], new RegExp(`page:${page.id}`));
    // a purge that throws is logged, the save still succeeds
    setPurgeFetch((async () => {
      throw new Error("down");
    }) as never);
    const v2 = (await getSite(m, s.id))!.version;
    assert.equal((await updateSiteSettings(m, s.id, settings, v2)).kind, "ok");
    // unset env: no calls
    delete process.env.NETLIFY_PURGE_TOKEN;
    bodies.length = 0;
    setPurgeFetch((async (_u: unknown, init: { body: string }) => (bodies.push(init.body), new Response("{}"))) as never);
    await updateSiteSettings(m, s.id, settings, (await getSite(m, s.id))!.version);
    assert.equal(bodies.length, 0);
  } finally {
    delete process.env.NETLIFY_PURGE_TOKEN;
    delete process.env.NETLIFY_SITE_ID;
  }
});
