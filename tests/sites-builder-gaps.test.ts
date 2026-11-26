// Builder additions: extra form questions, section anchors, multi-intake order
// blocks, the Embed block and the logo marquee (no database needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswers, withAnswers } from "../lib/sites/answers.ts";
import { cleanPage } from "../lib/sites/clean.ts";
import { embedDocument } from "../lib/sites/embed.ts";
import { routeFor } from "../lib/sites/host.ts";
import { customFieldSchema, leadFormSettingsSchema, orderClassCodes, orderFormSettingsSchema } from "../lib/sites/model.ts";
import { pageCss } from "../lib/sites/render/css.ts";
import { renderPageHtml } from "../lib/sites/render/html.ts";
import { buildPayload, parseSettings } from "../lib/sites/runtime-core.ts";
import { elementPropsSchema } from "../lib/sites/tree.ts";
import { parsePage } from "../lib/sites/tree-server.ts";
import { col, el, page, pageOf, row, sec } from "./sites-fixtures.ts";

const ctx = { pageId: "0b1c2d3e-0000-4000-8000-000000000001", steps: [] };
const render = (p: unknown, c: { pageId: string; steps: never[]; draft?: boolean } = ctx) => {
  const r = parsePage(p);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return renderPageHtml(r.page, c);
};

const funding = customFieldSchema.parse({
  key: "funding", label: "Funding", kind: "choice", options: ["Self-funded", "HRDC"], hrdcOption: "HRDC", required: true,
});
const pax = customFieldSchema.parse({ key: "pax", label: "Pax", kind: "pax" });
const sessions = customFieldSchema.parse({ key: "sessions", label: "Sessions", kind: "multi", options: ["Sat", "Sun", "Eve"] });
const addr = customFieldSchema.parse({ key: "addr", label: "Address", kind: "address" });

// ---- extra questions ----

test("custom field schema: choice needs options, hrdcOption must be one of them, keys are unique and not standard", () => {
  assert.ok(!customFieldSchema.safeParse({ key: "a", label: "A", kind: "choice", options: ["x"] }).success);
  assert.ok(!customFieldSchema.safeParse({ key: "a", label: "A", kind: "choice", options: ["x", "x"] }).success);
  assert.ok(!customFieldSchema.safeParse({ key: "a", label: "A", kind: "choice", options: ["x", "y"], hrdcOption: "z" }).success);
  assert.ok(!customFieldSchema.safeParse({ key: "a", label: "A", kind: "multi", options: ["x"], hrdcOption: "x" }).success);
  assert.ok(!customFieldSchema.safeParse({ key: "a", label: "A", kind: "text", options: ["x"] }).success);
  assert.ok(!customFieldSchema.safeParse({ key: "email", label: "E", kind: "text" }).success);
  assert.ok(!customFieldSchema.safeParse({ key: "Bad key", label: "E", kind: "text" }).success);
  const base = { type: "interest", fields: [], createDeal: false, after: { kind: "message", text: "x" } };
  assert.ok(leadFormSettingsSchema.safeParse({ ...base, custom: [funding, pax] }).success);
  assert.ok(!leadFormSettingsSchema.safeParse({ ...base, custom: [funding, funding] }).success);
  assert.ok(leadFormSettingsSchema.safeParse(base).success); // old settings still valid
});

test("answers: choice, multi, pax, address; HRDC choice sets the flag", () => {
  const f = [funding, sessions, pax, addr];
  const ok = checkAnswers(f, { funding: "HRDC", sessions: ["Eve", "Sat"], pax: "12", addr: "1 Jalan A\n50000 KL" });
  assert.deepEqual(ok, {
    ok: true,
    hrdc: true,
    lines: ["Funding: HRDC", "Sessions: Sat, Eve", "Pax: 12", "Address: 1 Jalan A, 50000 KL"],
  });
  const self = checkAnswers(f, { funding: "Self-funded" });
  assert.deepEqual(self, { ok: true, hrdc: false, lines: ["Funding: Self-funded"] });
});

test("answers: required, unknown options and bad numbers are refused; unknown keys ignored", () => {
  assert.deepEqual(checkAnswers([funding], {}), { ok: false, fields: { funding: "required" } });
  assert.deepEqual(checkAnswers([funding], { funding: "Free" }), { ok: false, fields: { funding: "invalid" } });
  assert.deepEqual(checkAnswers([sessions], { sessions: ["Sat", "Mon"] }), { ok: false, fields: { sessions: "invalid" } });
  for (const v of ["0", "501", "1.5", "-2", "abc", "1e2"]) assert.equal(checkAnswers([pax], { pax: v }).ok, false, v);
  assert.equal(checkAnswers([pax], { pax: 7 }).ok, true);
  assert.deepEqual(checkAnswers([pax], { pax: "007" }), { ok: true, hrdc: false, lines: ["Pax: 7"] });
  assert.deepEqual(checkAnswers([], { evil: "x" }), { ok: true, hrdc: false, lines: [] });
  assert.deepEqual(checkAnswers([addr], { addr: "x".repeat(501) }), { ok: false, fields: { addr: "invalid" } });
  assert.deepEqual(checkAnswers(undefined, "nope"), { ok: true, hrdc: false, lines: [] });
});

test("answers join the visitor's message, capped at the CRM's 2000 characters", () => {
  assert.equal(withAnswers("Hello", ["A: 1", "B: 2"]), "Hello\nA: 1\nB: 2");
  assert.equal(withAnswers(undefined, ["A: 1"]), "A: 1");
  assert.equal(withAnswers(undefined, []), undefined);
  assert.equal(withAnswers("x".repeat(3000), ["A: 1"])?.length, 2000);
});

// ---- order block: several intakes ----

test("order settings: classCodes, effective codes, old settings unchanged", () => {
  assert.deepEqual(orderClassCodes({ classCode: " C1 " }), ["C1"]);
  assert.deepEqual(orderClassCodes({ classCode: "ignored", classCodes: ["A", "B"] }), ["A", "B"]);
  assert.deepEqual(orderClassCodes({ classCode: "", classCodes: [] }), [""]);
  assert.ok(orderFormSettingsSchema.safeParse({ classCode: "C1", askCompany: false }).success);
  assert.ok(orderFormSettingsSchema.safeParse({ classCode: "", classCodes: ["A", "B"], askCompany: true, custom: [funding] }).success);
  assert.ok(!orderFormSettingsSchema.safeParse({ classCode: "", classCodes: new Array(13).fill("A"), askCompany: true }).success);
});

test("runtime reads intakes and extra questions; a blank intake or a bad question is refused or dropped", () => {
  const multi = parseSettings(JSON.stringify({ classCode: "", classCodes: ["A", "B"], askCompany: false, custom: [funding, { key: "x", label: "L", kind: "evil" }] }), "order")!;
  assert.deepEqual(multi.classCodes, ["A", "B"]);
  assert.equal(multi.classCode, "A");
  assert.deepEqual(multi.custom.map((c) => c.key), ["funding"]);
  assert.equal(parseSettings('{"classCode":"","classCodes":["A",""],"askCompany":false}', "order"), null);
  assert.equal(parseSettings('{"classCode":"","classCodes":[],"askCompany":false}', "order"), null);
  const form = parseSettings(JSON.stringify({ fields: [], custom: [pax] }), "form")!;
  assert.equal(form.custom[0].kind, "pax");
});

test("payload: answers only for asked questions; classCode only for a listed intake of a multi block", () => {
  const ids = { pageId: "p", formId: "f", idempotencyKey: "k", landingUrl: "u", referrer: "" };
  const s = parseSettings(JSON.stringify({ classCode: "", classCodes: ["A", "B"], askCompany: false, custom: [funding] }), "order")!;
  const p = buildPayload(s, ids, { fullName: "N" }, true, undefined, { answers: { funding: "HRDC", other: "x" }, classCode: "B" });
  assert.deepEqual(p.answers, { funding: "HRDC" });
  assert.equal(p.classCode, "B");
  assert.ok(!("classCode" in buildPayload(s, ids, {}, true, undefined, { classCode: "EVIL" })));
  const one = parseSettings('{"classCode":"A","askCompany":false}', "order")!;
  assert.ok(!("classCode" in buildPayload(one, ids, {}, true, undefined, { classCode: "A" })));
  assert.ok(!("answers" in buildPayload(one, ids, {}, true, undefined, { answers: { a: "1" } })));
});

// ---- anchors ----

test("a section's anchor becomes its id; anchors are unique and well-formed", () => {
  const html = render(page([sec([row([col()])], { anchor: "pricing" }), sec([row([col()])])]));
  assert.match(html, /<section class="sec [^"]*" id="pricing">/);
  assert.equal(html.match(/<section[^>]* id=/g)?.length, 1);
  assert.equal(parsePage(page([sec([row([col()])], { anchor: "a" }), sec([row([col()])], { anchor: "a" })])).ok, false);
  for (const bad of ["Pricing", "1st", "a b", "a_b", "x".repeat(41), ""]) assert.equal(parsePage(page([sec([row([col()])], { anchor: bad })])).ok, false, bad);
  assert.equal(parsePage(page([sec([row([col()])])])).ok, true); // no anchor: unchanged
  const kept = cleanPage(html, "");
  assert.deepEqual(kept.removed, []);
  assert.match(kept.html, /id="pricing"/);
});

// ---- Embed block ----

test("embed props: https page or html, sensible height", () => {
  const ok = (p: object) => elementPropsSchema("embed")!.safeParse({ mode: "url", url: "", html: "", height: 400, title: "", ...p }).success;
  assert.ok(ok({ url: "https://example.com/demo" }));
  for (const url of ["http://example.com", "javascript:alert(1)", "data:text/html,x", "//example.com", "/local"]) assert.ok(!ok({ url }), url);
  assert.ok(!ok({ height: 10 }));
  assert.ok(!ok({ height: 5000 }));
  assert.ok(!ok({ mode: "script" }));
  assert.ok(!ok({ html: "x".repeat(100_001) }));
});

test("embed renders a sandboxed frame: the page's own address, or the embed route for html", () => {
  const url = render(pageOf(el("embed", { mode: "url", url: "https://demo.example.com/game", height: 600, title: "Game" }, "e_u")));
  assert.match(url, /<iframe [^>]*src="https:\/\/demo\.example\.com\/game"/);
  assert.match(url, /sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"/);
  assert.doesNotMatch(url, /allow-same-origin/);
  const html = render(pageOf(el("embed", { mode: "html", html: "<script>alert(1)</script><p>hi</p>", title: "T" }, "e_h")));
  assert.match(html, new RegExp(`src="/api/site/embed/${ctx.pageId}/e_h"`));
  assert.doesNotMatch(html, /alert|srcdoc/); // the html never appears in the page itself
  const draft = render(pageOf(el("embed", { mode: "html", html: "<b>x</b>" }, "e_h")), { ...ctx, draft: true });
  assert.match(draft, /srcdoc="&lt;b&gt;x&lt;\/b&gt;"/);
  assert.doesNotMatch(render(pageOf(el("embed", {}, "e_n"))), /<iframe/); // nothing to show yet
  const withCss = parsePage(pageOf(el("embed", { height: 600 }, "e_u")));
  assert.ok(withCss.ok);
  const clean = cleanPage(url + html, pageCss(withCss.page));
  assert.deepEqual(clean.removed, []);
  assert.equal(clean.html.match(/<iframe/g)?.length, 2);
  assert.doesNotMatch(clean.html, /allow-same-origin/);
});

test("embed css sets the frame height", () => {
  const r = parsePage(pageOf(el("embed", { height: 640 }, "e_u")));
  assert.ok(r.ok);
  assert.match(pageCss(r.page), /\.lp \.xe_u \.e-embed iframe\{height:640px\}/);
});

test("embedDocument wraps a fragment and leaves a whole document alone", () => {
  assert.match(embedDocument("<p>x</p>"), /^<!doctype html>.*<body><p>x<\/p><\/body><\/html>$/);
  assert.equal(embedDocument("<!DOCTYPE html><html></html>"), "<!DOCTYPE html><html></html>");
});

test("the public host serves the embed route and nothing near it", () => {
  const id = "0b1c2d3e-0000-4000-8000-000000000001";
  assert.deepEqual(routeFor("ai.thelead.io", `/api/site/embed/${id}/e_abc`), { action: "pass" });
  assert.equal(routeFor("ai.thelead.io", `/api/site/embed/${id}`).action, "rewrite");
  assert.equal(routeFor("ai.thelead.io", `/api/site/embed/${id}/e_abc/x`).action, "rewrite");
  assert.equal(routeFor("app.thelead.io", `/api/site/embed/${id}/e_abc`).action, "app");
});

// ---- logo marquee ----

test("logo strip: still by default, marquee has two tracks with the copy hidden from screen readers", () => {
  const items = [{ src: "https://x.test/a.png", alt: "A" }, { src: "https://x.test/b.png", alt: "B" }];
  const still = render(pageOf(el("logos", { items }, "e_l")));
  assert.match(still, /<div class="e-logos"><img/);
  assert.doesNotMatch(still, /class="tr"/);
  const mq = render(pageOf(el("logos", { items, marquee: true, speed: 25 }, "e_l")));
  assert.equal(mq.match(/class="tr"/g)?.length, 2);
  assert.match(mq, /<div class="tr" aria-hidden="true"><img src="https:\/\/x.test\/a.png" alt=""/);
  assert.equal(mq.match(/alt="A"/g)?.length, 1);
  const r = parsePage(pageOf(el("logos", { items, marquee: true, speed: 25 }, "e_l")));
  assert.ok(r.ok);
  const css = pageCss(r.page);
  assert.match(css, /\.lp \.xe_l \.e-logos\{--mq:25s\}/);
  assert.match(css, /@keyframes lp-mq/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.lp \.e-logos\.mq/);
  assert.deepEqual(cleanPage(mq, css).removed, []);
  assert.ok(!elementPropsSchema("logos")!.safeParse({ items: [], height: { d: 40 }, marquee: true, speed: 3 }).success);
});
