import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getSite, updateSiteSettings } from "../lib/sites/admin.ts";
import { publishPage, setRedirect, unpublishPage } from "../lib/sites/publish.ts";
import { pageResponse, renderDocument, resolve } from "../lib/sites/serve.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const settings = {
  pixels: { meta: "123456789", google: "G-ABCDE12345", tiktok: "bad id'<" },
  capi: false,
  paymentMode: "test" as const,
  seo: { title: "My <Title>" },
  privacyUrl: "https://example.com/privacy",
};

async function published() {
  const m = await newUser("marketing");
  const base = `/t-${crypto.randomUUID().slice(0, 8)}`;
  const { siteId } = await createFunnel(m, { name: "F", language: "zh", basePath: base });
  let s = (await getSite(m, siteId))!;
  await updateSiteSettings(m, siteId, settings, s.version);
  s = (await getSite(m, siteId))!;
  const page = s.steps[0];
  await db()`UPDATE sales.page_version SET html = '<p>hello</p>', css = 'p{color:red}' WHERE page_id = ${page.id} AND status = 'draft'`;
  const r = await publishPage(m, page.id, page.version);
  assert.equal(r.kind, "ok");
  return { m, base, page };
}

it("unknown path on ai.thelead.io returns the holding page with 404, not a sign-in redirect", async () => {
  const r = await resolve("ai.thelead.io", "/nope-" + crypto.randomUUID().slice(0, 8));
  assert.deepEqual(r, { kind: "holding", language: "en", status: 404 });
});

it("a redirect route answers its target", async () => {
  const m = await newUser("marketing");
  const path = `/r-${crypto.randomUUID().slice(0, 8)}`;
  await setRedirect(m, "ai.thelead.io", path, "https://example.com/x");
  assert.deepEqual(await resolve("ai.thelead.io", path), { kind: "redirect", to: "https://example.com/x" });
});

it("a published page returns its html with the cache tag and CSP", async () => {
  const { base, page } = await published();
  const r = await resolve("ai.thelead.io", base + "/");
  assert.equal(r.kind, "page");
  if (r.kind !== "page") return;
  const res = pageResponse(r);
  assert.equal(res.headers.get("Netlify-Cache-Tag"), `page:${page.id}`);
  assert.match(res.headers.get("Content-Security-Policy")!, /script-src 'self' 'nonce-[^']+' https:\/\/connect\.facebook\.net/);
  assert.match(await res.text(), /<p>hello<\/p>/);
});

it("SEO title and Meta pixel id appear, invalid or unset pixels do not", async () => {
  const { base } = await published();
  const r = await resolve("ai.thelead.io", base);
  assert.equal(r.kind, "page");
  if (r.kind !== "page") return;
  const html = renderDocument(r, r.site, "N0NCE");
  assert.match(html, /<title>My &lt;Title&gt;<\/title>/);
  assert.match(html, /fbq\('init','123456789'\)/);
  assert.match(html, /gtag\('config','G-ABCDE12345'\)/);
  assert.doesNotMatch(html, /ttq|linkedin/);
  assert.match(html, /<script nonce="N0NCE">/);
  assert.match(html, /\/site\/runtime\.js/);
});

it("an unpublished page shows the holding page in its language, status 200", async () => {
  const { m, base, page } = await published();
  await unpublishPage(m, page.id);
  assert.deepEqual(await resolve("ai.thelead.io", base), { kind: "holding", language: "zh", status: 200 });
});
