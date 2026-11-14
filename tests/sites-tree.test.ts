import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultProps, ELEMENT_TYPES, newId, presetColumns } from "../lib/sites/tree.ts";
import { parsePage, sanitizePage } from "../lib/sites/tree-server.ts";
import { sanitizeRich } from "../lib/sites/richtext.ts";

const el = (type: string, props?: unknown) => ({
  id: newId("e"), kind: "el", type, name: type, anim: "none",
  box: { mt: 0, mb: 0, pt: 0, pr: 0, pb: 0, pl: 0, bg: "", radius: 0 },
  props: props ?? defaultProps(type as never),
});
const col = (els: unknown[] = []) => ({ id: newId("c"), kind: "col", name: "c", pad: { t: 0, r: 0, b: 0, l: 0 }, bg: "", radius: 0, els });
const row = (cols: unknown[], preset = String(cols.length)) => ({
  id: newId("r"), kind: "row", name: "r", preset, gap: { d: 24 }, mt: 0, mb: 0, valign: "start", cols,
});
const sec = (rows: unknown[]) => ({
  id: newId("s"), kind: "sec", name: "s", width: "wide", bg: "#fff", pt: { d: 64 }, pb: { d: 64 },
  hideOn: { d: false, t: false, m: false }, anim: "none", rows,
});
const page = (sections: unknown[]) => ({ version: 2, sections, popups: [] });

test("valid tree passes, and every element type has valid defaults", () => {
  const els = ELEMENT_TYPES.map((t) => el(t));
  const r = parsePage(page([sec([row([col(els)])])]));
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(presetColumns("1/3+2/3" as never), 2);
});

test("an element directly in a section or row is refused", () => {
  assert.equal(parsePage(page([{ ...sec([]), rows: [el("para")] }])).ok, false);
  assert.equal(parsePage(page([sec([{ ...row([col()]), cols: [el("para")] }])])).ok, false);
});

test("column count must match preset", () => {
  assert.equal(parsePage(page([sec([row([col(), col(), col()], "2")])])).ok, false);
  assert.ok(parsePage(page([sec([row([col(), col()], "2/3+1/3")])])).ok);
});

test("unknown element type and bad props are refused", () => {
  assert.equal(parsePage(page([sec([row([col([el("marquee", {})])])])])).ok, false);
  assert.equal(parsePage(page([sec([row([col([el("button", { text: 1 })])])])])).ok, false);
});

test("over 1.5 MB (many valid sections) is refused with the size message", () => {
  const text = "x".repeat(10_000);
  const heavy = () => sec([row([col(Array.from({ length: 15 }, () => el("para", { ...(defaultProps("para") as object), text })))])]);
  const r = parsePage(page(Array.from({ length: 12 }, heavy)));
  assert.ok(!r.ok && /too large/.test(r.message));
});

test("URL fields: only empty, https, mailto, tel, #, /path", () => {
  const link = (u: string) => parsePage(page([sec([row([col([el("image", { src: "", alt: "", link: u, align: "left" })])])])])).ok;
  for (const ok of ["", "https://a.com", "mailto:a@b.c", "tel:+60123", "#form", "/thanks"]) assert.ok(link(ok), ok);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://a.com", "//evil.com", "/\\evil.com", " javascript:x", "ftp://a"]) {
    assert.equal(link(bad), false, bad);
  }
  assert.equal(parsePage(page([sec([row([col([el("nav", { items: [{ label: "x", href: "javascript:1" }], align: "left", color: "" })])])])])).ok, false);
  assert.equal(parsePage(page([{ ...sec([]), bgImage: "http://x.com/a.png" }])).ok, false);
});

test("duplicate ids are refused; unknown prop keys are stripped", () => {
  const e = el("divider");
  assert.equal(parsePage(page([sec([row([col([e, e])])])])).ok, false);
  const r = parsePage(page([sec([row([col([el("divider", { color: "", thickness: 1, junk: 1 })])])])]));
  assert.ok(r.ok);
  assert.deepEqual(r.page.sections[0].rows[0].cols[0].els[0].props, { color: "", thickness: 1 });
});


test("sanitizeRich strips style/class/script/js hrefs, keeps allowed tags and tokens", () => {
  assert.equal(sanitizeRich('<p style="x" class="y">a<script>alert(1)</script></p>'), "a");
  assert.equal(sanitizeRich('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeRich('<a href="/rel">x</a>'), "<a>x</a>");
  assert.equal(
    sanitizeRich('<b>b</b><i>i</i><u>u</u><s>s</s><br /><a href="https://x.com" onclick="y">a</a> {{course_name}}'),
    '<b>b</b><i>i</i><u>u</u><s>s</s><br /><a href="https://x.com">a</a> {{course_name}}',
  );
  assert.equal(sanitizeRich('<a href="#form">go</a>'), '<a href="#form">go</a>');
});

test("sanitizePage cleans element text", () => {
  const p = parsePage(page([sec([row([col([el("para", { ...(defaultProps("para") as object), text: "<script>x</script><b>ok</b>" })])])])]));
  assert.ok(p.ok);
  const clean = sanitizePage(p.page);
  assert.equal((clean.sections[0].rows[0].cols[0].els[0].props as { text: string }).text, "<b>ok</b>");
});

test("sanitizePage: rich fields only, list/faq items and popups included, ampersands stay valid", () => {
  const para = el("para", { ...(defaultProps("para") as object), text: "A & B <script>x</script>" });
  const list = el("list", { items: ['<b>ok</b><i style="x">y</i>'], size: { d: 17 }, color: "" });
  const faq = el("faq", { items: [["<u>q</u><script>1</script>", '<a href="javascript:1">a</a>']] });
  const btn = el("button", { ...(defaultProps("button") as object), text: "Tom & <Jerry>" });
  const s = sec([row([col([para, list, faq, btn])])]);
  const p = parsePage({ ...page([s]), popups: [{ id: newId("p"), name: "p", trigger: "button", sections: [sec([row([col([el("para", { ...(defaultProps("para") as object), text: "<script>y</script>z" })])])])] }] });
  assert.ok(p.ok);
  const c = sanitizePage(p.page);
  const els = c.sections[0].rows[0].cols[0].els.map((e) => e.props as Record<string, unknown>);
  assert.equal(els[0].text, "A &amp; B ");
  assert.deepEqual(els[1].items, ["<b>ok</b><i>y</i>"]);
  assert.deepEqual(els[2].items, [["<u>q</u>", "<a>a</a>"]]);
  assert.equal(els[3].text, "Tom & <Jerry>"); // plain field untouched
  assert.equal((c.popups[0].sections[0].rows[0].cols[0].els[0].props as { text: string }).text, "z");
});
