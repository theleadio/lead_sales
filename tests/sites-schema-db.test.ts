// Migration 006: the sites tables exist, one draft per page and variant,
// route paths are lowercase slugs, and deleting a site cascades.
import { after } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import { it } from "./seed.ts";

after(closeDb);

async function newPage() {
  const [s] = await db()`
    INSERT INTO sales.site (kind, name, base_path, language)
    VALUES ('funnel', 'T', ${`/t-${crypto.randomUUID().slice(0, 8)}`}, 'en')
    RETURNING id`;
  const [p] = await db()`
    INSERT INTO sales.site_page (site_id, position, name, path)
    VALUES (${s.id}, 1, 'P', '/p') RETURNING id`;
  return { siteId: s.id as string, pageId: p.id as string };
}

it("006 creates the sites tables", async () => {
  const rows = await db()`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'sales' AND table_name = ANY(${[
      "site_folder",
      "site",
      "site_page",
      "page_version",
      "site_route",
      "global_section",
      "site_template",
      "page_view_day",
      "page_view_seen",
      "capi_event",
    ]})`;
  assert.equal(rows.length, 10);
});

it("a second draft for the same page and variant is refused", async () => {
  const { pageId } = await newPage();
  await db()`INSERT INTO sales.page_version (page_id, status) VALUES (${pageId}, 'draft')`;
  await db()`INSERT INTO sales.page_version (page_id, variant, status) VALUES (${pageId}, 'B', 'draft')`;
  await db()`INSERT INTO sales.page_version (page_id, status) VALUES (${pageId}, 'published')`;
  await assert.rejects(
    db()`INSERT INTO sales.page_version (page_id, status) VALUES (${pageId}, 'draft')`,
    /page_version_one_draft/,
  );
});

it("a route path with capitals or spaces is refused", async () => {
  const add = (p: string) =>
    db()`INSERT INTO sales.site_route (domain, path) VALUES ('ai.thelead.io', ${p})`;
  await add("/");
  await add("/a-b/c1");
  await assert.rejects(add("/Promo"), /check/i);
});

it("a route path with a space is refused", async () => {
  await assert.rejects(
    db()`INSERT INTO sales.site_route (domain, path) VALUES ('ai.thelead.io', '/a b')`,
    /check/i,
  );
});

it("deleting a site removes its pages and versions", async () => {
  const { siteId, pageId } = await newPage();
  await db()`INSERT INTO sales.page_version (page_id, status) VALUES (${pageId}, 'draft')`;
  await db()`DELETE FROM sales.site WHERE id = ${siteId}`;
  const [{ n }] = await db()`
    SELECT (SELECT count(*) FROM sales.site_page WHERE site_id = ${siteId})
         + (SELECT count(*) FROM sales.page_version WHERE page_id = ${pageId}) AS n`;
  assert.equal(Number(n), 0);
});
