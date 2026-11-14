import { test } from "node:test";
import assert from "node:assert/strict";
import { makeElement, makeRow, makeSection } from "../lib/sites/editor-state.ts";
import { dropTarget, type Rect } from "../lib/sites/dnd.ts";
import { chip, escText, mapTag, plainToRich, safeHref, serialize, toEditable, type MiniNode } from "../lib/sites/richclient.ts";
import type { Page } from "../lib/sites/tree.ts";

// two sections; s1 has a 2-col row with 2 elements in col 0
const s1 = makeSection("wide");
const s2 = makeSection("wide");
const row = makeRow("2");
s1.rows = [row, makeRow("1")];
const e1 = makeElement("headline");
const e2 = makeElement("para");
row.cols[0].els = [e1, e2];
const page: Page = { version: 2, sections: [s1, s2], popups: [{ id: "p1", name: "Pop", trigger: "button", delaySec: 0, sections: [makeSection("wide")] } as never] };
// every node 100 high, stacked by id order
const rects: Record<string, Rect> = {
  [s1.id]: { left: 0, top: 0, width: 800, height: 300 },
  [s2.id]: { left: 0, top: 300, width: 800, height: 200 },
  [row.id]: { left: 0, top: 0, width: 800, height: 150 },
  [s1.rows[1].id]: { left: 0, top: 150, width: 800, height: 150 },
  [row.cols[0].id]: { left: 0, top: 0, width: 400, height: 150 },
  [e1.id]: { left: 0, top: 0, width: 400, height: 60 },
  [e2.id]: { left: 0, top: 60, width: 400, height: 60 },
};
const rectOf = (id: string) => rects[id] ?? null;

test("sections drop between sections by midpoint", () => {
  const a = dropTarget(page, null, "sec", null, e1.id, 200, rectOf);
  assert.deepEqual(a?.target, { parentId: "page", index: 1 });
  assert.equal(a?.line.y, 300); // before s2
  const b = dropTarget(page, null, "sec", null, e1.id, 450, rectOf);
  assert.deepEqual(b?.target, { parentId: "page", index: 2 }); // after the last
  assert.equal(dropTarget(page, null, "sec", null, e1.id, 10, rectOf)?.target.index, 0);
});

test("moving onto its own position is null; elsewhere counts the index before removal", () => {
  assert.equal(dropTarget(page, null, "sec", s1.id, s1.id, 200, rectOf), null); // before s2 == after s1 itself
  assert.equal(dropTarget(page, null, "sec", s2.id, s2.id, 450, rectOf), null);
  assert.deepEqual(dropTarget(page, null, "sec", s1.id, s2.id, 450, rectOf)?.target, { parentId: "page", index: 2 });
});

test("rows go into the section under the pointer; elements into a column", () => {
  assert.deepEqual(dropTarget(page, null, "row", null, e1.id, 200, rectOf)?.target, { parentId: s1.id, index: 1 });
  assert.equal(dropTarget(page, null, "row", null, s2.id, 400, rectOf)?.target.parentId, s2.id); // empty-ish section (one default row? no rects -> end)
  assert.deepEqual(dropTarget(page, null, "el", null, e2.id, 10, rectOf)?.target, { parentId: row.cols[0].id, index: 0 });
  assert.equal(dropTarget(page, null, "el", e1.id, e2.id, 100, rectOf)?.target.index, 2); // e1 moved after e2 is a real move
});

test("elements need a column; sections and rows are not elements", () => {
  assert.equal(dropTarget(page, null, "el", null, s1.id, 10, rectOf), null);
  assert.equal(dropTarget(page, null, "el", null, row.id, 10, rectOf), null);
  assert.equal(dropTarget(page, null, "col", null, e1.id, 10, rectOf), null);
  assert.equal(dropTarget(page, null, "sec", null, null, 10, rectOf), null);
});

test("an empty column accepts an element", () => {
  const c = row.cols[1];
  rects[c.id] = { left: 400, top: 0, width: 400, height: 150 };
  const d = dropTarget(page, null, "el", null, c.id, 70, rectOf);
  assert.deepEqual(d?.target, { parentId: c.id, index: 0 });
  assert.equal(d?.line.y, 75);
});

test("popup sections use popup:<id>", () => {
  const ps = page.popups[0].sections[0];
  rects[ps.id] = { left: 0, top: 0, width: 500, height: 100 };
  assert.deepEqual(dropTarget(page, "p1", "sec", null, ps.id, 90, rectOf)?.target, { parentId: "popup:p1", index: 1 });
});

// ---- rich text (DOM-free: plain object trees) ----
type T = string | { tag: string; attrs?: Record<string, string>; kids?: T[] };
const mk = (t: T): MiniNode => t !== null && typeof t === "object" && t.tag === "#comment" ? { nodeType: 8, nodeName: "#comment", textContent: "x", childNodes: [] } :
  typeof t === "string"
    ? { nodeType: 3, nodeName: "#text", textContent: t, childNodes: [] }
    : { nodeType: 1, nodeName: t.tag.toUpperCase(), textContent: null, childNodes: (t.kids ?? []).map(mk), getAttribute: (n) => t.attrs?.[n] ?? null };
const ser = (...k: T[]) => serialize(mk({ tag: "div", kids: k }));

test("serialize keeps b i u s a br and maps strong/em/strike", () => {
  assert.equal(ser({ tag: "strong", kids: ["x"] }, { tag: "em", kids: ["y"] }, { tag: "strike", kids: ["z"] }, { tag: "br" }), "<b>x</b><i>y</i><s>z</s><br>");
});
test("serialize strips styles, classes, scripts, comments; keeps text", () => {
  const out = ser(
    { tag: "span", attrs: { style: "color:red", class: "x" }, kids: ["keep ", { tag: "script", kids: ["alert(1)"] }] },
    { tag: "#comment" } as never,
    { tag: "o:p", kids: ["word"] },
  );
  assert.equal(out, "keep word");
});
test("Google Docs wrapper <b font-weight:normal> is not bold", () => {
  assert.equal(ser({ tag: "b", attrs: { style: "font-weight:normal" }, kids: [{ tag: "p", kids: ["a"] }, { tag: "p", kids: ["b"] }] }), "a<br>b");
});
test("links: only https/mailto/tel/#, others unwrap to text", () => {
  assert.equal(ser({ tag: "a", attrs: { href: "https://x.my/a?b=1&c=2" }, kids: ["go"] }), '<a href="https://x.my/a?b=1&amp;c=2">go</a>');
  assert.equal(ser({ tag: "a", attrs: { href: "javascript:alert(1)" }, kids: ["bad"] }), "bad");
  assert.equal(ser({ tag: "a", attrs: { href: "/relative" }, kids: ["rel"] }), "rel");
  assert.equal(safeHref(" tel:+60123 "), "tel:+60123");
  assert.equal(safeHref("data:text/html,x"), null);
});
test("text is escaped; chips serialise back to {{key}}; tokens in text survive", () => {
  assert.equal(ser("a < b & {{k_1}}", { tag: "span", attrs: { "data-key": "price" }, kids: ["RM99"] }), "a &lt; b &amp; {{k_1}}{{price}}");
  assert.equal(ser({ tag: "span", attrs: { "data-key": "Bad Key" }, kids: ["x"] }), "");
});
test("toEditable chips round trip", () => {
  const html = "Pay {{price}} <b>now</b> {{gone}}";
  const shown = toEditable(html, { price: "RM<1>" });
  assert.equal(shown, `Pay ${chip("price", "RM<1>")} <b>now</b> ${chip("gone", "{{gone}}")}`);
  assert.equal(escText("&<>"), "&amp;&lt;&gt;");
  assert.equal(plainToRich("a\r\nb<c"), "a<br>b&lt;c");
  assert.equal(mapTag("DEL"), "s");
});
