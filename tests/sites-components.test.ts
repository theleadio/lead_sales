import test from "node:test";
import assert from "node:assert/strict";
import { cleanPage } from "../lib/sites/clean.ts";
import { leadFormSettingsSchema, orderFormSettingsSchema } from "../lib/sites/model.ts";
import { components } from "../lib/sites/publish.ts";
import { ALL, ROWS, renderDef, type Ctx } from "../app/(app)/sites/editor/components/index.ts";
import {
  counterWrite,
  formProps,
  formWrite,
  linkWrite,
  orderWrite,
  resolveHref,
  waWrite,
} from "../app/(app)/sites/editor/components/settings.ts";
import { BRAND_PALETTE, DEVICES, FONTS } from "../app/(app)/sites/editor/panels.ts";
import { BASE_CSS } from "../app/(app)/sites/editor/components/base-css.ts";

const ctx: Ctx = {
  steps: [
    { id: "p1", name: "Home", path: "/w", kind: "page" },
    { id: "p2", name: "Payment", path: "/w/payment", kind: "checkout" },
  ],
  classes: [],
  sections: [],
};
const def = (type: string) => ALL.find((d) => d.type === type)!;
const html = (type: string, id = "abc-123") => renderDef(def(type), ctx, id);

test("every component in the brief exists", () => {
  const want = [
    "lead-section", "lead-row", "lead-column", "lead-nested-column", "lead-heading", "lead-subheading",
    "lead-paragraph", "lead-rich-text", "lead-bullet-list", "lead-image", "lead-image-slider", "lead-svg",
    "lead-divider", "lead-button", "lead-number-counter", "lead-social-icons", "lead-logo-showcase", "lead-faq",
    "lead-nav-menu", "lead-form", "lead-order-form", "lead-register-button", "lead-whatsapp-button", "lead-global-section",
  ];
  for (const t of want) assert.ok(ALL.some((d) => d.type === t), t);
  assert.equal(new Set(ALL.map((d) => d.type)).size, ALL.length);
  assert.ok(!ALL.some((d) => /custom|code|embed/.test(d.type)), "no custom-code component");
});

test("LEAD form is an empty placeholder with a stable id and valid default settings", () => {
  const h = html("lead-form", "f-1234");
  assert.match(h, /^<div [^>]*data-lead="form"/);
  assert.match(h, /data-id="f-1234"/);
  assert.ok(h.endsWith("></div>"), "no children");
  assert.doesNotMatch(h, /<form|<input|consent/i);
  const settings = JSON.parse(/data-settings='([^']*)'/.exec(h)![1]);
  assert.ok(leadFormSettingsSchema.safeParse(settings).success);
  assert.equal(formProps(JSON.stringify(settings)).s_type, "interest");
});

test("order form and global section markers", () => {
  const o = html("lead-order-form", "o-1");
  assert.match(o, /data-lead="order" data-id="o-1" data-settings='\{"classCode":"","askCompany":false\}'><\/div>$/);
  const g = html("lead-global-section", "0b9d3f5e-1111-4222-8333-444455556666");
  assert.match(g, /data-lead="global-section" data-id="0b9d3f5e-1111-4222-8333-444455556666"><\/div>$/);
});

test("FAQ items are [question, ...answer]; slider children are slides; counter carries {to}", () => {
  const faq = html("lead-faq");
  assert.match(faq, /data-lead="faq"/);
  const items = faq.match(/<div class="lead-faq-item">.*?<\/p><\/div>/g)!;
  assert.equal(items.length, 3);
  for (const i of items) assert.match(i, /^<div class="lead-faq-item"><h4 [^>]*>[^<]*<\/h4><p /);
  const slider = html("lead-image-slider");
  assert.match(slider, /data-lead="slider"/);
  assert.equal(slider.match(/class="lead-slide"/g)!.length, 3);
  assert.match(html("lead-number-counter"), /data-lead="counter" data-settings='\{"to":100\}'/);
  assert.deepEqual(counterWrite({ s_to: "250" }), { attrs: { "data-settings": '{"to":250}' }, text: "250" });
  assert.ok(counterWrite({ s_to: "abc" }).error);
});

test("buttons: https URL, a step path, #form; register goes to checkout; WhatsApp to wa.me", () => {
  assert.equal(resolveHref("form", ""), "#form");
  assert.equal(resolveHref("step:/w/payment", ""), "/w/payment");
  assert.equal(resolveHref("url", "https://example.com/a"), "https://example.com/a");
  assert.equal(resolveHref("url", "http://example.com"), null);
  assert.equal(resolveHref("url", "javascript:alert(1)"), null);
  assert.ok(linkWrite({ s_link: "url", s_url: "data:text/html,x" }).error);
  assert.match(html("lead-register-button"), /href="\/w\/payment"/);
  assert.match(html("lead-button"), /href="#form"/);
  assert.deepEqual(waWrite({ s_phone: "+60 12-345 6789" }), { attrs: { href: "https://wa.me/60123456789" } });
  assert.ok(waWrite({ s_phone: "12" }).error);
});

test("form settings are validated before they are written", () => {
  const base = { s_type: "interest", s_afterKind: "message", s_afterText: "Thanks" };
  const ok = formWrite({ ...base, s_company: true });
  assert.deepEqual(JSON.parse(ok.attrs!["data-settings"]).fields, ["company"]);
  assert.ok(formWrite({ ...base, s_type: "workshop" }).error, "workshop needs title and a real date");
  assert.ok(formWrite({ ...base, s_type: "workshop", s_wTitle: "T", s_wDate: "2026-02-31" }).error);
  const w = formWrite({ ...base, s_type: "workshop", s_wTitle: "T", s_wDate: "2026-12-01" });
  assert.equal(JSON.parse(w.attrs!["data-settings"]).workshop.date, "2026-12-01");
  assert.ok(formWrite({ ...base, s_afterKind: "url", s_afterUrl: "http://x.com" }).error);
  assert.ok(formWrite({ ...base, s_afterKind: "step", s_afterStep: "" }).error);
  assert.ok(orderFormSettingsSchema.safeParse(JSON.parse(orderWrite({ s_classCode: "C1" }).attrs!["data-settings"])).success);
});

test("default markup survives the publish cleaner untouched, and the markers are found afterwards", () => {
  const id = "0b9d3f5e-1111-4222-8333-444455556666";
  const page = ALL.map((d) => renderDef(d, ctx, id)).join("") + ROWS.map((r) => r.html).join("");
  const out = cleanPage(page, BASE_CSS);
  assert.deepEqual(out.removed, []);
  assert.equal(components(out.html, "form").length, 1);
  assert.ok(leadFormSettingsSchema.safeParse(components(out.html, "form")[0].settings).success);
  assert.equal(components(out.html, "order").length, 1);
  assert.equal(components(out.html, "global-section")[0].id, id);
});

test("editor config: devices, fonts, brand palette", () => {
  assert.deepEqual(DEVICES.map((d) => d.width), ["1280px", "768px", "375px"]);
  assert.deepEqual([...FONTS], ["Inter", "Poppins", "Noto Sans SC", "Noto Serif SC", "Montserrat"]);
  assert.deepEqual(BRAND_PALETTE.slice(0, 4), ["#0a0a0a", "#3d3d3d", "#a1bace", "#fbe33b"]);
});

test("starter templates: clean, placeholder copy, forms valid, three of them", async () => {
  const { TEMPLATES } = await import("../scripts/site-templates-data.ts");
  assert.deepEqual(TEMPLATES.map((t) => t.name), ["Workshop sign-up", "Paid course", "Lead magnet"]);
  for (const t of TEMPLATES)
    for (const s of t.steps) {
      const out = cleanPage(s.html, s.css);
      assert.deepEqual(out.removed, [], `${t.name} / ${s.name}`);
      assert.match(s.html, /\[placeholder\]/);
      assert.doesNotMatch(s.html, /RM\s?\d|testimonial|\d+%/i);
      for (const f of components(out.html, "form")) assert.ok(leadFormSettingsSchema.safeParse(f.settings).success);
    }
  assert.equal(TEMPLATES[1].steps[1].kind, "checkout");
  // Workshop template's form counts for Home's Free workshops: type workshop, a real future date.
  const [wf] = components(TEMPLATES[0].steps[0].html, "form");
  const ws = leadFormSettingsSchema.parse(wf.settings);
  assert.equal(ws.type, "workshop");
  assert.match(ws.workshop!.title, /\[placeholder\]/);
  assert.ok(ws.workshop!.date > new Date().toISOString().slice(0, 10));
});
