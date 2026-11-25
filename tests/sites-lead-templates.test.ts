// The LEAD-styled starter templates (scripts/site-templates-data.ts): valid v2
// trees, LEAD's colours only, every piece of copy still marked as a
// placeholder, and the forms set up the way publishing needs. Pure: no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageSchema, type Element, type Page } from "../lib/sites/tree.ts";
import { LEAD_COLORS, TEMPLATES } from "../scripts/site-templates-data.ts";

const els = (p: Page): Element[] => p.sections.flatMap((s) => s.rows.flatMap((r) => r.cols.flatMap((c) => c.els)));
const lead = TEMPLATES.filter((t) => t.name.startsWith("LEAD · "));

// Every string a visitor reads, per element type.
function copyOf(e: Element): string[] {
  const p = e.props as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.type) {
    case "headline": case "sub": case "para": case "icon-text": return [p.text];
    case "list": return p.items;
    case "faq": return p.items.flat();
    case "button": return [p.text, p.sub];
    case "image": return [p.alt];
    case "form": case "order": return [p.button];
    case "nav": return p.items.map((i: { label: string }) => i.label);
    default: return [];
  }
}

test("there are two LEAD templates: a paid bootcamp and a free webinar", () => {
  assert.deepEqual(
    lead.map((t) => [t.name, t.steps.map((s) => s.kind)]),
    [
      ["LEAD · AI bootcamp (paid)", ["page", "checkout", "thank_you"]],
      ["LEAD · Free webinar", ["page", "thank_you"]],
    ],
  );
});

test("each step is a valid page with only marked copy", () => {
  for (const t of lead)
    for (const s of t.steps) {
      assert.ok(pageSchema.safeParse(s.project).success, `${t.name} / ${s.name}`);
      const unmarked = els(s.project).flatMap(copyOf).filter((x) => x !== "" && x !== "“" && !/\[placeholder[\] —]/.test(x));
      assert.deepEqual(unmarked, [], `${t.name} / ${s.name}`);
    }
});

test("they use LEAD's colours, not the library's neutral ones", () => {
  for (const t of lead) {
    const json = JSON.stringify(t.steps).toLowerCase();
    for (const from of Object.keys(LEAD_COLORS)) assert.ok(!json.includes(`"${from}"`), `${t.name} still has ${from}`);
    assert.ok(json.includes('"#fbe33b"'), `${t.name} uses LEAD yellow`);
  }
});

test("the webinar collects sign-ups with a workshop form; the bootcamp pays on its checkout step", () => {
  const [bootcamp, webinar] = lead;
  const form = els(webinar.steps[0].project).find((e) => e.type === "form");
  assert.equal((form?.props as { settings: { type: string } }).settings.type, "workshop");
  assert.ok(els(bootcamp.steps[1].project).some((e) => e.type === "order"));
  // The hero button goes to the next step on the bootcamp, to the form on the webinar.
  const heroButton = (p: Page) => els({ ...p, sections: [p.sections[0]] }).find((e) => e.type === "button")!.props as { action: string };
  assert.equal(heroButton(bootcamp.steps[0].project).action, "next");
  assert.equal(heroButton(webinar.steps[0].project).action, "form");
});

test("the FAQs ask the questions LEAD customers ask, with answers left to fill in", () => {
  const faq = els(lead[0].steps[0].project).find((e) => e.type === "faq")!.props as { items: [string, string][] };
  assert.ok(faq.items.some(([q]) => /HRDC/.test(q)));
  assert.ok(faq.items.every(([, a]) => a === "[placeholder] Answer"));
});
