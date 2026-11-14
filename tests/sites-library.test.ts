// Sections library and v2 starter templates: valid trees, fresh ids, honest copy,
// idempotent seed, and publishable (the order form still needs a class chosen).
import { after } from "node:test";
import assert from "node:assert/strict";
import { createFunnel, getDraft, getSite, updateSiteSettings } from "../lib/sites/admin.ts";
import { LIBRARY } from "../lib/sites/library.ts";
import { publishPage } from "../lib/sites/publish.ts";
import { pageSchema, type Element, type Page, type Section } from "../lib/sites/tree.ts";
import { closeDb, db } from "../lib/sql.ts";
import { seedTemplates } from "../scripts/seed-site-templates.ts";
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

it("the seed is idempotent and removes only v1 templates and drafts", async () => {
  const sql = db();
  const m = await newUser("marketing");
  const v1 = `v1 ${crypto.randomUUID().slice(0, 6)}`;
  await sql`INSERT INTO sales.site_template (kind, name, payload) VALUES ('funnel', ${v1}, ${sql.json({ steps: [{ name: "Home", kind: "page", suffix: "", project: { gjs: [1] } }] } as never)})`;
  const keep = `v2 keep ${crypto.randomUUID().slice(0, 6)}`;
  await sql`INSERT INTO sales.site_template (kind, name, payload) VALUES ('funnel', ${keep}, ${sql.json({ steps: [TEMPLATES[0].steps[0]] } as never)})`;
  const { siteId } = await createFunnel(m, { name: "Old", language: "en", basePath: `/s-${crypto.randomUUID().slice(0, 8)}` });
  const [old, fresh] = (await getSite(m, siteId))!.steps;
  await sql`UPDATE sales.page_version SET project = ${sql.json({ gjs: [1] })} WHERE page_id = ${old.id} AND status = 'draft'`;
  const v2 = pageSchema.parse((await getDraft(m, fresh.id)).project);

  await seedTemplates();
  const count = async () => (await sql`SELECT count(*)::int AS n FROM sales.site_template WHERE kind = 'funnel' AND name = ANY(${TEMPLATES.map((t) => t.name)})`)[0].n;
  assert.equal(await count(), 3);
  assert.equal((await sql`SELECT 1 FROM sales.site_template WHERE name = ${v1}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM sales.site_template WHERE name = ${keep}`).length, 1);
  assert.deepEqual((await getDraft(m, old.id)).project, {}); // v1 draft gone: reads as blank
  assert.deepEqual((await getDraft(m, fresh.id)).project, v2);

  await seedTemplates();
  assert.equal(await count(), 3);
  await sql`DELETE FROM sales.site_template WHERE name = ${keep}`;
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
