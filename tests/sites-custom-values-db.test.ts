// lib/sites/custom-values: {{key}} tokens, escaped substitution at serve time, purge on change.
import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getSite, SitesPermissionError, updateSiteSettings } from "../lib/sites/admin.ts";
import { applyValues, listCustomValues, saveCustomValue } from "../lib/sites/custom-values.ts";
import { publishPage, setPurgeFetch } from "../lib/sites/publish.ts";
import { handleRender } from "../lib/sites/serve.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";
import { formPage, paraPage, setDraftTree } from "./sites-fixtures.ts";

after(closeDb);

const key = () => "k_" + crypto.randomUUID().replaceAll("-", "").slice(0, 10);

it("applyValues escapes values and blanks unknown keys", async () => {
  const out = applyValues("a {{x_y}} b {{nope}} c", new Map([["x_y", `<script>"&'`]]));
  assert.equal(out, "a &lt;script&gt;&quot;&amp;&#39; b  c");
});

it("create, update at the right version, conflict on a stale one; sales cannot edit", async () => {
  const m = await newUser("marketing");
  const k = key();
  const c = await saveCustomValue(m, { key: k, label: "Shop", value: "one" }, null);
  assert.deepEqual(c, { kind: "ok", version: 1 });
  assert.deepEqual(await saveCustomValue(m, { key: k, label: "Shop", value: "dup" }, null), { kind: "conflict" });
  assert.deepEqual(await saveCustomValue(m, { key: k, label: "Shop", value: "two" }, 1), { kind: "ok", version: 2 });
  assert.deepEqual(await saveCustomValue(m, { key: k, label: "Shop", value: "stale" }, 1), { kind: "conflict" });
  const sales = await newUser("sales");
  assert.equal((await listCustomValues(sales)).find((v) => v.key === k)?.value, "two");
  await assert.rejects(saveCustomValue(sales, { key: k, label: "x", value: "y" }, 2), SitesPermissionError);
  await assert.rejects(saveCustomValue(m, { key: "Bad Key", label: "x", value: "y" }, null));
  const audits = await db()`SELECT action FROM audit_log WHERE entity = 'custom_value' AND user_id = ${m.id} ORDER BY at`;
  assert.deepEqual(audits.map((a) => a.action).sort(), ["create", "update"]);
});

it("a value with <script> renders escaped in body and title, and a change purges the live page", async () => {
  const m = await newUser("marketing");
  const k = key();
  const base = `/t-${crypto.randomUUID().slice(0, 8)}`;
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base });
  let s = (await getSite(m, siteId))!;
  await updateSiteSettings(
    m, siteId,
    { pixels: {}, capi: false, paymentMode: "test", seo: { title: `Welcome {{${k}}}`, description: `About {{${k}}}` }, privacyUrl: "https://example.com/privacy" },
    s.version,
  );
  s = (await getSite(m, siteId))!;
  const page = s.steps[0];
  await setDraftTree(page.id, paraPage(`Hello {{${k}}} and {{missing_one}}!`));
  await saveCustomValue(m, { key: k, label: "Shop", value: "<script>alert(1)</script>" }, null);
  assert.equal((await publishPage(m, page.id, page.version)).kind, "ok");

  // The stored html keeps the token.
  const [live] = await db()`SELECT v.html FROM sales.site_page p JOIN sales.page_version v ON v.id = p.active_version_id WHERE p.id = ${page.id}`;
  assert.ok(live.html.includes(`{{${k}}}`));

  const html = await (await handleRender("ai.thelead.io", base)).text();
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt; and !/);
  assert.match(html, /<title>Welcome &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
  assert.match(html, /<meta name="description" content="About &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);

  // Changing the value purges every live page's tag, and the next serve shows the new value.
  const purged: string[] = [];
  process.env.NETLIFY_PURGE_TOKEN = "t";
  process.env.NETLIFY_SITE_ID = "s";
  setPurgeFetch((async (_u: unknown, init: { body: string }) => {
    purged.push(init.body);
    return new Response("{}");
  }) as never);
  try {
    assert.deepEqual(await saveCustomValue(m, { key: k, label: "Shop", value: "Acme" }, 1), { kind: "ok", version: 2 });
  } finally {
    delete process.env.NETLIFY_PURGE_TOKEN;
  }
  assert.ok(purged.some((b) => b.includes(`page:${page.id}`)));
  assert.match(await (await handleRender("ai.thelead.io", base)).text(), /<title>Welcome Acme<\/title>/);
});

it("a value with quote, backslash and newline keeps the form's data-settings valid JSON", async () => {
  const m = await newUser("marketing");
  const k = key();
  const base = `/t-${crypto.randomUUID().slice(0, 8)}`;
  const { siteId } = await createFunnel(m, { name: "F", language: "en", basePath: base });
  let s = (await getSite(m, siteId))!;
  await updateSiteSettings(m, siteId, { pixels: {}, capi: false, paymentMode: "test", seo: {}, privacyUrl: "https://example.com/privacy" }, s.version);
  s = (await getSite(m, siteId))!;
  const page = s.steps[0];
  const nasty = 'say "hi" \ back\nnext <b> & \'x\'';
  const settings = { type: "interest", fields: [], createDeal: false, after: { kind: "message", text: `Thanks {{${k}}}!` } };
  await setDraftTree(page.id, formPage("form-1", settings));
  await saveCustomValue(m, { key: k, label: "Nasty", value: nasty }, null);
  assert.equal((await publishPage(m, page.id, page.version)).kind, "ok");
  const html = await (await handleRender("ai.thelead.io", base)).text();
  const attr = /data-settings="([^"]*)"/.exec(html)![1];
  const decoded = attr.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  assert.equal(JSON.parse(decoded).after.text, `Thanks ${nasty}!`);
});
