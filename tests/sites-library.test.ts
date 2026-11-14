// Sections library and v2 starter templates: valid trees, fresh ids, honest copy,
// idempotent seed, and publishable (the order form still needs a class chosen).
import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getDraft, getSite, updateSiteSettings } from "../lib/sites/admin.ts";
import { LIBRARY } from "../lib/sites/library.ts";
import { publishPage } from "../lib/sites/publish.ts";
import { pageSchema, type Element, type Page, type Section } from "../lib/sites/tree.ts";
import { closeDb, db } from "../lib/sql.ts";
import { isLocalUrl, purgeV1, seedTemplates } from "../scripts/seed-site-templates.ts";
import { TEMPLATES } from "../scripts/site-templates-data.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const wrap = (...s: Section[]): Page => ({ version: 2, sections: s, popups: [] });
const ids = (s: Section) => [s.id, ...s.rows.flatMap((r) => [r.id, ...r.cols.flatMap((c) => [c.id, ...c.els.map((e) => e.id)])])];
const els = (p: Page): Element[] => p.sections.flatMap((s) => s.rows.flatMap((r) => r.cols.flatMap((c) => c.els)));

// Structural labels that carry no claim: an empty string and the opening quote mark of a testimonial card.
const ALLOW = new Set(["", "“"]);
function copyOf(e: Element): string[] {
  const p = e.props as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.type) {
    case "headline": case "sub": case "para": case "icon-text": return [p.text];
    case "list": return p.items;
    case "faq": return p.items.flat();
    case "button": return [p.text, p.sub];
    case "image": return [p.alt];
    case "form": case "order": return [p.button];
    case "countdown": return [p.doneText];
    case "nav": return p.items.map((i: { label: string }) => i.label);
    case "counter": return [p.label];
    case "logos": case "slider": return p.items.map((i: { alt: string }) => i.alt);
    default: return [];
  }
}
const unmarked = (p: Page) => els(p).flatMap(copyOf).filter((t) => !ALLOW.has(t) && !/\[placeholder[\] —]/.test(t));

it("the library has the twelve sections of spec 6", async () => {
  assert.equal(LIBRARY.length, 12);
  assert.deepEqual([...new Set(LIBRARY.map((l) => l.category))].length, 11); // Hero twice
  assert.equal(new Set(LIBRARY.map((l) => `${l.category}/${l.name}`)).size, 12);
});

it("every library section validates, builds fresh ids, and has only marked copy", async () => {
  for (const l of LIBRARY) {
    const a = l.build();
    const b = l.build();
    const r = pageSchema.safeParse(wrap(a));
    assert.ok(r.success, `${l.name}: ${r.success ? "" : r.error.issues[0].message}`);
    const used = new Set(ids(a));
    assert.ok(ids(b).every((i) => !used.has(i)), `${l.name}: ids reused across builds`);
    assert.deepEqual(unmarked(wrap(a)), [], l.name);
  }
});

it("the footer has a privacy link, the sign-up form a LEAD form, the testimonials ask for a real quote", async () => {
  const get = (id: string) => wrap(LIBRARY.find((l) => l.id === id)!.build());
  const nav = els(get("footer")).find((e) => e.type === "nav")!.props as { items: { label: string; href: string }[] };
  assert.match(nav.items[0].label, /^\[placeholder\] Privacy policy$/);
  assert.ok(["/privacy", "#"].includes(nav.items[0].href));
  assert.ok(els(get("signup")).some((e) => e.type === "form"));
  assert.match(JSON.stringify(get("testimonials")), /paste a real attendee quote with their permission/);
  const cd = els(get("countdown")).find((e) => e.type === "countdown")!.props as { to: string };
  const days = (new Date(cd.to).getTime() - Date.now()) / 864e5;
  assert.ok(days > 28 && days < 31, String(days));
});

it("the starter templates are v2 trees with only marked copy", async () => {
  assert.deepEqual(TEMPLATES.map((t) => t.steps.map((s) => s.kind)), [["page"], ["page", "checkout", "thank_you"], ["page", "thank_you"]]);
  for (const t of TEMPLATES) {
    for (const s of t.steps) {
      assert.ok(pageSchema.safeParse(s.project).success, `${t.name} / ${s.name}`);
      assert.deepEqual(unmarked(s.project), [], `${t.name} / ${s.name}`);
    }
  }
  const forms = (n: number) => els(TEMPLATES[n].steps[0].project).filter((e) => e.type === "form");
  assert.equal((forms(0)[0].props as { settings: { type: string } }).settings.type, "workshop");
  assert.ok(els(TEMPLATES[1].steps[1].project).some((e) => e.type === "order"));
});

it("the plain seed only upserts: idempotent, and it leaves v1 and blank data alone", async () => {
  const sql = db();
  const m = await newUser("marketing");
  const v1 = `v1 ${crypto.randomUUID().slice(0, 6)}`;
  await sql`INSERT INTO sales.site_template (kind, name, payload) VALUES ('funnel', ${v1}, ${sql.json({ steps: [{ name: "Home", kind: "page", suffix: "", project: { gjs: [1] } }] } as never)})`;
  const { siteId } = await createFunnel(m, { name: "Old", language: "en", basePath: `/s-${crypto.randomUUID().slice(0, 8)}` });
  const [old] = (await getSite(m, siteId))!.steps;
  await sql`UPDATE sales.page_version SET project = ${sql.json({ gjs: [1] })} WHERE page_id = ${old.id} AND status = 'draft'`;
  const count = async () => (await sql`SELECT count(*)::int AS n FROM sales.site_template WHERE kind = 'funnel' AND name = ANY(${TEMPLATES.map((t) => t.name)})`)[0].n;
  await seedTemplates();
  await seedTemplates();
  assert.equal(await count(), 3);
  assert.equal((await sql`SELECT 1 FROM sales.site_template WHERE name = ${v1}`).length, 1);
  assert.deepEqual((await getDraft(m, old.id)).project, { gjs: [1] });
});

it("purgeV1 refuses a non-local database url without connecting", async () => {
  for (const u of ["postgresql://u:p@db.example.com:5432/x", "postgresql://u:p@aws-0.pooler.supabase.com/postgres", "", undefined, "nonsense"]) {
    await assert.rejects(purgeV1(u), /local database/);
  }
  for (const u of ["postgresql://u@localhost/x", "postgresql://u@127.0.0.1:5432/x", "postgresql://u@[::1]/x"]) assert.ok(isLocalUrl(u), u);
});

it("purgeV1 deletes only real v1 templates and drafts", async () => {
  const sql = db();
  const m = await newUser("marketing");
  const tag = crypto.randomUUID().slice(0, 6);
  const tpl = (name: string, steps: unknown[]) =>
    sql`INSERT INTO sales.site_template (kind, name, payload) VALUES ('funnel', ${name}, ${sql.json({ steps } as never)})`;
  const step = (project?: unknown, html?: string) => ({ name: "Home", kind: "page", suffix: "", ...(project === undefined ? {} : { project }), ...(html ? { html } : {}) });
  await tpl(`gjs ${tag}`, [step({ gjs: [1] })]);
  await tpl(`html ${tag}`, [step(undefined, "<p>old</p>")]);
  await tpl(`v2blank ${tag}`, [step({ version: 2, sections: [], popups: [] }), step({})]);
  await tpl(`mixed ${tag}`, [step({ gjs: [1] }), step(TEMPLATES[0].steps[0].project)]);
  await tpl(`noproject ${tag}`, [step()]);
  await tpl(`empty ${tag}`, [step({})]);

  const { siteId } = await createFunnel(m, { name: "P", language: "en", basePath: `/p-${crypto.randomUUID().slice(0, 8)}` });
  const [gjs, html, blank] = (await getSite(m, siteId))!.steps;
  await sql`UPDATE sales.page_version SET project = ${sql.json({ gjs: [1] })} WHERE page_id = ${gjs.id} AND status = 'draft'`;
  await sql`UPDATE sales.page_version SET project = ${sql.json({})}, html = '<p>old</p>' WHERE page_id = ${html.id} AND status = 'draft'`;
  await sql`UPDATE sales.page_version SET project = ${sql.json({})} WHERE page_id = ${blank.id} AND status = 'draft'`;
  // published and archived versions with v1 content are never touched
  for (const status of ["published", "archived"]) {
    await sql`INSERT INTO sales.page_version (page_id, project, html, css, status) VALUES (${blank.id}, ${sql.json({ gjs: [1] })}, '<p>x</p>', '', ${status})`;
  }

  const out = await purgeV1("postgresql://u@localhost/x");
  assert.ok(out.templates.includes(`gjs ${tag}`) && out.templates.includes(`html ${tag}`));
  const left = (await sql`SELECT name FROM sales.site_template WHERE name LIKE ${"% " + tag}`).map((r) => r.name);
  assert.deepEqual(left.sort(), [`empty ${tag}`, `mixed ${tag}`, `noproject ${tag}`, `v2blank ${tag}`]);
  const status = async (id: string) => (await sql`SELECT status FROM sales.page_version WHERE page_id = ${id} ORDER BY status`).map((r) => r.status);
  assert.deepEqual(await status(gjs.id), []); // v1 draft gone
  assert.deepEqual(await status(html.id), []);
  assert.deepEqual(await status(blank.id), ["archived", "draft", "published"]); // {} draft, published, archived stay
  assert.deepEqual((await getDraft(m, blank.id)).project, {});
});

it("a funnel from each starter template publishes (the order form needs its class chosen first)", async () => {
  const sql = db();
  await seedTemplates();
  const m = await newUser("marketing");
  for (const t of TEMPLATES) {
    const [row] = await sql`SELECT id FROM sales.site_template WHERE kind = 'funnel' AND name = ${t.name}`;
    const { siteId } = await createFunnel(m, { name: t.name, language: "en", basePath: `/t-${crypto.randomUUID().slice(0, 8)}`, templateId: row.id });
    const s0 = (await getSite(m, siteId))!;
    await updateSiteSettings(m, siteId, { pixels: {}, capi: false, paymentMode: "test", seo: {}, privacyUrl: "https://example.com/privacy" }, s0.version);
    for (const step of (await getSite(m, siteId))!.steps) {
      const r = await publishPage(m, step.id, step.version);
      if (step.kind === "checkout") {
        assert.equal(r.kind, "refused", `${t.name} / ${step.name}`);
        assert.match((r as { reasons: string[] }).reasons.join(), /no class chosen/);
      } else {
        assert.equal(r.kind, "ok", `${t.name} / ${step.name}: ${JSON.stringify(r)}`);
      }
    }
  }
});
