import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultProps, ELEMENT_TYPES, MAX_PROJECT_BYTES, newId, parsePage, presetColumns, sanitizePage } from "../lib/sites/tree.ts";
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

test("over 1.5 MB is refused", () => {
  const big = el("para", { ...(defaultProps("para") as object), text: "x".repeat(MAX_PROJECT_BYTES) });
  assert.equal(parsePage(page([sec([row([col([big])])])])).ok, false);
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
