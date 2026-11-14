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
import { el, formPage, orderPage, pageOf, paraPage, setDraftTree } from "./sites-fixtures.ts";

after(closeDb);

const settings = { pixels: {}, capi: false, paymentMode: "test" as const, seo: {}, privacyUrl: "https://example.com/privacy" };
const form = (date: string) =>
  formPage("form-1", {
    type: "workshop",
    workshop: { title: "AI", date, language: "en" },
    fields: [],
    createDeal: true,
    after: { kind: "message", text: "ok" },
  });

async function setup(withPrivacy = true, tree: unknown = paraPage("hi")) {
  const m = await newUser("marketing");
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: `/t-${crypto.randomUUID().slice(0, 8)}` });
  let s = (await getSite(m, siteId))!;
  if (withPrivacy) await updateSiteSettings(m, siteId, settings, s.version);
  s = (await getSite(m, siteId))!;
  const page = s.steps[0];
  await setDraftTree(page.id, tree);
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
  const { m, s, page } = await setup(true, paraPage("one"));
  await publishPage(m, page.id, page.version);
  await setDraftTree(page.id, paraPage("two"));
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
  const { m, s } = await setup(true, paraPage("ok"));
  const bad = s.steps[1];
  await setDraftTree(bad.id, orderPage("o1", { classCode: "", askCompany: false }));
  const r = await publishSite(m, s.id);
  assert.equal(r.kind, "refused");
  const [n] = await db()`SELECT count(*)::int AS n FROM sales.page_version WHERE page_id = ${s.steps[0].id} AND status = 'published'`;
  assert.equal(n.n, 0);
  await setDraftTree(bad.id, paraPage("fine"));
  assert.equal((await publishSite(m, s.id)).kind, "ok");
  const [a] = await audits("site", s.id).then((x) => x.filter((y) => y.after?.what === "publish"));
  assert.equal(a.after.pageIds.length, 3);
});

it("an order form without a class is refused", async () => {
  const { m, page } = await setup(true, orderPage("o1", { classCode: "", askCompany: false }));
  assert.equal((await publishPage(m, page.id, page.version)).kind, "refused");
});

it("a v2 tree round-trips: html and css are rendered at publish; a non-v2 draft is refused; a blank draft publishes empty", async () => {
  const { m, s, page } = await setup(true, pageOf(el("headline", { text: "Big <b>deal</b>" }, "e_h"), el("button", { text: "Next", action: "next" }, "e_b")));
  assert.equal((await publishPage(m, page.id, page.version)).kind, "ok");
  const [live] = await db()`SELECT v.html, v.css, v.project FROM sales.site_page p JOIN sales.page_version v ON v.id = p.active_version_id WHERE p.id = ${page.id}`;
  assert.match(live.html, /<h2 class="t">Big <b>deal<\/b><\/h2>/);
  assert.match(live.html, new RegExp(`href="${s.steps[1].path}" data-action="next"`));
  assert.match(live.css, /\.lp \.xe_h \.t\{font-size:44px\}/);
  assert.equal(live.project.version, 2);
  const old = s.steps[1];
  await db()`UPDATE sales.page_version SET project = ${db().json({ gjs: [1] })} WHERE page_id = ${old.id} AND status = 'draft'`;
  const r = await publishPage(m, old.id, old.version);
  assert.equal(r.kind, "refused");
  assert.match((r as { reasons: string[] }).reasons.join(), /cannot be published/);
  const blank = s.steps[2]; // new draft: {}
  assert.equal((await publishPage(m, blank.id, blank.version)).kind, "ok");
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

it("a button pointing at a deleted popup refuses publishing", async () => {
  const tree = pageOf(el("button", { action: "popup", popupId: "p_gone" }));
  const { m, page } = await setup(true, tree);
  const r = await publishPage(m, page.id, page.version);
  assert.equal(r.kind, "refused");
  assert.match((r as { reasons: string[] }).reasons.join(), /popup that no longer exists/);
});
