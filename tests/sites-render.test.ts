import { test } from "node:test";
import assert from "node:assert/strict";
import { leadFormSettingsSchema, orderFormSettingsSchema } from "../lib/sites/model.ts";
import { pageCss } from "../lib/sites/render/css.ts";
import { renderPageHtml } from "../lib/sites/render/html.ts";
import { cleanPage } from "../lib/sites/clean.ts";
import { parsePage } from "../lib/sites/tree-server.ts";
import { col, el, page, pageOf, row, sec } from "./sites-fixtures.ts";

const ctx = { pageId: "p1", steps: [{ id: "p1", path: "/a" }, { id: "p2", path: "/a/next" }] };
const render = (p: unknown, c = ctx) => {
  const r = parsePage(p);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return renderPageHtml(r.page, c);
};
const css = (p: unknown) => {
  const r = parsePage(p);
  assert.ok(r.ok);
  return pageCss(r.page);
};
const one = (type: string, props?: Record<string, unknown>, id = "e_one") => render(pageOf(el(type, props, id)));

test("text elements: rich text rendered as HTML, other strings escaped", () => {
  assert.match(one("headline", { text: "Hi <b>there</b>{{name}}" }), /<h2 class="t">Hi <b>there<\/b>\{\{name\}\}<\/h2>/);
  assert.match(one("sub", { text: "x" }), /<h3 class="t">x<\/h3>/);
  assert.match(one("para", { text: "x<script>1</script>" }), /<p class="t">x<\/p>/); // sanitised before render
  assert.match(one("list", { items: ["a", "<i>b</i>"] }), /<ul class="e-list"><li>a<\/li><li><i>b<\/i><\/li><\/ul>/);
  assert.match(one("button", { text: "<b>x</b>", sub: "" }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("form button's no-JS anchor points at an existing id", () => {
  const html = render(pageOf(el("button", { text: "Go", action: "form" }, "e_b"), el("form", undefined, "e_form")));
  const m = /<a class="btn t" href="#([^"]*)"/.exec(html)!;
  assert.ok(html.includes(`id="${m[1]}"`));
});

test("buttons are real links with data-action", () => {
  const link = (props: Record<string, unknown>, c = ctx) => {
    const html = render(pageOf(el("button", { text: "Go", ...props }, "e_b"), el("form", undefined, "e_form")), c);
    return /<a class="btn t" href="([^"]*)" data-action="([^"]*)">/.exec(html)!.slice(1);
  };
  assert.deepEqual(link({ action: "form" }), ["#e_form", "form"]);
  assert.deepEqual(link({ action: "next" }), ["/a/next", "next"]);
  assert.deepEqual(link({ action: "next" }, { pageId: "p2", steps: ctx.steps }), ["#", "next"]);
  assert.deepEqual(link({ action: "popup", popupId: "p_x" }), ["#", "popup:p_x"]);
  assert.deepEqual(link({ action: "url", url: "https://example.com/x" }), ["https://example.com/x", "url"]);
});

test("form and order render as the runtime placeholders; settings parse with their schemas", () => {
  const html = render(pageOf(el("form", undefined, "e_f"), el("order", { settings: { classCode: "AI-1", askCompany: true } }, "e_o")));
  const tags = [...html.matchAll(/<div id="[^"]+" data-lead="(form|order)" data-id="([^"]+)" data-settings="([^"]*)"/g)];
  assert.deepEqual(tags.map((t) => [t[1], t[2]]), [["form", "e_f"], ["order", "e_o"]]);
  const dec = (s: string) => JSON.parse(s.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.ok(leadFormSettingsSchema.safeParse(dec(tags[0][3])).success);
  assert.ok(orderFormSettingsSchema.safeParse(dec(tags[1][3])).success);
});

test("remaining element types render their markup", () => {
  assert.match(one("image", { src: "https://x.test/a.png", alt: "A", link: "" }), /<div class="im"><img src="https:\/\/x.test\/a.png" alt="A" loading="lazy"\/><\/div>/);
  assert.match(one("image", { src: "", alt: "A" }), /<div class="e-img" role="img" aria-label="A">/);
  assert.match(one("video", { url: "https://youtu.be/dQw4w9WgXcQ" }), /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(one("video", { url: "https://evil.test/x" }), /<div class="e-vid"><\/div>/);
  assert.match(one("faq", { items: [["Q?", "A <b>b</b>"]] }), /<details><summary>Q\?<\/summary><p>A <b>b<\/b><\/p><\/details>/);
  assert.match(one("countdown", { to: "2030-01-01T09:00", doneText: "Done" }), /<div class="e-cd" data-cd="2030-01-01T09:00" data-done="Done">/);
  assert.match(one("divider"), /<div class="e-div"><\/div>/);
  assert.match(one("icon-text", { icon: "star", text: "x" }), /<span class="ic" aria-hidden="true">★<\/span><p class="t">x<\/p>/);
  assert.match(one("social", { items: [{ network: "facebook", url: "https://facebook.com/x" }] }), /<a href="https:\/\/facebook.com\/x">Facebook<\/a>/);
  assert.match(one("logos", { items: [{ src: "https://x.test/l.png", alt: "L" }] }), /<div class="e-logos"><img src="https:\/\/x.test\/l.png" alt="L"/);
  assert.match(one("counter", { to: 120, prefix: "+", suffix: "k", label: "Students" }), /<b>\+<span data-count="120">120<\/span>k<\/b><div>Students<\/div>/);
  assert.match(one("slider", { items: [{ src: "https://x.test/s.png", alt: "S" }], autoplay: true }), /<div class="e-sl" data-autoplay="1"><img/);
  assert.match(one("nav", { items: [{ label: "Home", href: "/" }] }), /<nav class="e-nav"><a href="\/">Home<\/a><\/nav>/);
});

test("popups render hidden at the end, with data-anim on animated nodes", () => {
  const p = page(
    [sec([row([col([el("para", { text: "main" })])])], { anim: "fade" })],
    [{ id: "p_1", name: "Exit", trigger: "timer", delaySec: 5, sections: [sec([row([col([el("para", { text: "pop" })])])])] }],
  );
  const html = render(p);
  assert.match(html, /<section class="sec [^"]*" data-anim="fade">/);
  assert.ok(html.indexOf("main") < html.indexOf('data-lead="popup"'));
  assert.match(html, /<div data-lead="popup" data-id="p_1" data-trigger="timer" data-delay="5" hidden="">/);
  assert.ok(html.endsWith("</div></div></section></div></div>"));
});

test("the cleaner keeps every hook the renderer emits", () => {
  const p = page(
    [sec([row([col([el("button", { text: "Go", action: "popup", popupId: "p_1" }), el("faq", { items: [["q", "a"]] }), el("countdown", { to: "2030-01-01T09:00" }), el("form")])])], { anim: "up" })],
    [{ id: "p_1", name: "P", trigger: "exit", sections: [] }],
  );
  const { html, removed } = cleanPage(render(p), css(p));
  assert.deepEqual(removed, []);
  for (const needle of ['data-action="popup:p_1"', 'data-anim="up"', "<details>", 'data-lead="popup"', " hidden", "data-cd=", "data-button="]) {
    assert.ok(html.includes(needle), needle);
  }
});

test("pageCss: desktop, tablet and phone rules; phone override survives a desktop change; tablet follows desktop", () => {
  const mk = (size: unknown) => page([sec([row([col([el("headline", { size, text: "x" }, "e_h")])])])]);
  const split = (c: string) => {
    const t = c.lastIndexOf("@media (max-width:991px)");
    const m = c.lastIndexOf("@media (max-width:575px)");
    return { d: c.slice(0, t), t: c.slice(t, m), m: c.slice(m) };
  };
  const a = split(css(mk({ d: 44, m: 30 })));
  assert.match(a.d, /\.lp \.xe_h \.t\{font-size:44px\}/);
  assert.doesNotMatch(a.t, /xe_h/); // no tablet override: falls back to desktop
  assert.match(a.m, /\.xe_h \.t\{font-size:30px\}/);
  const b = split(css(mk({ d: 60, m: 30 }))); // desktop changed
  assert.match(b.d, /font-size:60px/);
  assert.match(b.m, /font-size:30px/); // phone kept
  const c = split(css(mk({ d: 44, t: 36 }))); // phone follows tablet through the cascade
  assert.match(c.t, /font-size:36px/);
  assert.doesNotMatch(c.m, /xe_h/);
});

test("pageCss: stacking, hide classes, and unsafe colours are dropped", () => {
  const p = page([
    sec([row([col([el("para", { text: "x", color: "red;}body{display:none" }, "e_p")]), col()], "2")], {
      hideOn: { d: false, t: false, m: true },
      bg: "url(javascript:1)",
    }),
  ]);
  const c = css(p);
  assert.match(c, /@media \(max-width:575px\)\{[^@]*grid-template-columns:1fr/);
  assert.match(c, /\.lp \.hide-m\{display:none!important\}/);
  assert.match(render(p), /class="sec [^"]*hide-m"/);
  assert.doesNotMatch(c, /body\{|javascript/);
});

test("renderDraft (publish and preview): tree, blank draft and old-editor data", async () => {
  const { renderDraft } = await import("../lib/sites/render/html.ts");
  const ok = renderDraft(pageOf(el("para", { text: "hi" })), ctx);
  assert.ok(ok.ok && ok.html.includes(">hi</p>") && ok.css.includes(".lp"));
  const blank = renderDraft({}, ctx);
  assert.ok(blank.ok && blank.html === '<div class="lp"></div>');
  assert.equal(renderDraft({ gjs: [1] }, ctx).ok, false);
});

test("the static serialiser matches react-dom/server on every element type", async () => {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = (await import("react-dom/server")).default as typeof import("react-dom/server");
  const { PageView } = await import("../lib/sites/render/view.ts");
  const { ELEMENT_TYPES } = await import("../lib/sites/tree.ts");
  const p = page(
    [sec([row([col(ELEMENT_TYPES.map((t) => el(t)))])], { anim: "zoom", hideOn: { d: true, t: false, m: false } })],
    [{ id: "p_1", name: "P", trigger: "timer", delaySec: 3, sections: [sec([row([col([el("form")])])])] }],
  );
  const r = parsePage(p);
  assert.ok(r.ok);
  const view = React.createElement(PageView, { page: r.page, ctx });
  const { serialize } = await import("../lib/sites/render/html.ts");
  assert.equal(serialize(view), renderToStaticMarkup(view).replace(/&#x27;/g, "'"));
});

test("serialiser escapes hostile plain text and attributes exactly like react-dom/server", async () => {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = (await import("react-dom/server")).default as typeof import("react-dom/server");
  const { PageView } = await import("../lib/sites/render/view.ts");
  const { serialize } = await import("../lib/sites/render/html.ts");
  const bad = `"><svg onload=1> & ' <`;
  const url = `https://x.test/?a="&b=<'>`;
  const p = pageOf(
    el("button", { text: bad, sub: bad, action: "url", url }),
    el("image", { src: url, alt: bad, link: url }),
    el("social", { items: [{ network: "x", url }] }),
    el("nav", { items: [{ label: bad, href: url }] }),
    el("logos", { items: [{ src: url, alt: bad }] }),
    el("counter", { to: 1, prefix: `"<&`, suffix: `'>`, label: bad }),
    el("countdown", { to: bad, doneText: bad }),
    el("form", { button: bad }),
  );
  const r = parsePage(p);
  assert.ok(r.ok, r.ok ? "" : r.message);
  const view = React.createElement(PageView, { page: r.page, ctx });
  const ours = serialize(view);
  assert.equal(ours, renderToStaticMarkup(view).replace(/&#x27;/g, "'"));
  assert.ok(!ours.includes("<svg") && !ours.includes(`" onload`));
  // every raw "<" starts a real tag we emit, never user text
  assert.ok([...ours.matchAll(/<(?![a-z/])/g)].length === 0);
});

test("pageCss: site theme sets fonts, colours and background; bad values fall back", () => {
  const p = parsePage(pageOf(el("para", { text: "x" })));
  assert.ok(p.ok);
  const themed = pageCss(p.page, { settings: { theme: { headFont: "Poppins", bodyFont: "Noto Serif SC", text: "#222222", link: "#ff0000", bg: "#fafafa" } } });
  assert.match(themed, /\.lp\{--hf:"Poppins",system-ui,sans-serif;--cf:"Noto Serif SC",system-ui,sans-serif;--tc:#222222;--lc:#ff0000;background-color:#fafafa\}/);
  const bad = pageCss(p.page, { settings: { theme: { headFont: "Evil;}", text: "red;}body{x", bg: "url(x)" } } });
  assert.match(bad, /--hf:"Inter".*--tc:#111827;--lc:#2563eb;background-color:#ffffff/);
  assert.match(pageCss(p.page), /--tc:#111827/); // no site: defaults
});
