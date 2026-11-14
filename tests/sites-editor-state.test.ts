import { test } from "node:test";
import assert from "node:assert/strict";
import { pageSchema, type Page, type Row } from "../lib/sites/tree.ts";
import {
  findPath, initState, makeElement, makeRow, makeSection, reduce, validTarget, HISTORY_LIMIT,
  type Action, type EditorState,
} from "../lib/sites/editor-state.ts";

const freeze = <T>(o: T): T => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); }
  return o;
};
// run an action on a deep-frozen state; assert the input is untouched and the page still valid
function run(s: EditorState, a: Action): EditorState {
  freeze(s);
  const before = structuredClone(s);
  const n = reduce(s, a);
  assert.deepEqual(s, before);
  const r = pageSchema.safeParse(n.page);
  assert.ok(r.success, JSON.stringify(r.error?.issues[0]));
  return n;
}
const empty: Page = { version: 2, sections: [], popups: [] };

function build() {
  let s = initState(empty);
  const sA = makeSection("wide"), sB = makeSection("full");
  s = run(s, { type: "insert", kind: "sec", node: sA, at: { parentId: "page", index: 0 } });
  s = run(s, { type: "insert", kind: "sec", node: sB, at: { parentId: "page", index: 1 } });
  const r1 = makeRow("2"), r2 = makeRow("1");
  s = run(s, { type: "insert", kind: "row", node: r1, at: { parentId: sA.id, index: 0 } });
  s = run(s, { type: "insert", kind: "row", node: r2, at: { parentId: sA.id, index: 1 } });
  const e1 = makeElement("headline"), e2 = makeElement("para");
  s = run(s, { type: "insert", kind: "el", node: e1, at: { parentId: r1.cols[0].id, index: 0 } });
  s = run(s, { type: "insert", kind: "el", node: e2, at: { parentId: r1.cols[1].id, index: 0 } });
  return { s, sA, sB, r1, r2, e1, e2 };
}

test("insert builds a valid tree, selects the node, and records history", () => {
  const { s, e2 } = build();
  assert.equal(s.sel, e2.id);
  assert.equal(s.past.length, 6);
  assert.equal(findPath(s.page, e2.id)?.path.length, 4);
});

test("validTarget: kinds fit their parent; columns never move", () => {
  const { s, sA, r1 } = build();
  assert.ok(validTarget("sec", { parentId: "page", index: 0 }));
  assert.ok(validTarget("sec", { parentId: "popup:x", index: 0 }));
  assert.ok(validTarget("row", { parentId: sA.id, index: 0 }, s.page));
  assert.ok(!validTarget("row", { parentId: "page", index: 0 }));
  assert.ok(!validTarget("el", { parentId: sA.id, index: 0 }, s.page));
  assert.ok(validTarget("el", { parentId: r1.cols[0].id, index: 0 }, s.page));
  assert.ok(!validTarget("col", { parentId: r1.id, index: 0 }, s.page));
  assert.ok(!validTarget("row", { parentId: "nope", index: 0 }, s.page));
});

test("move onto itself or into its own position is a no-op (same state, no history)", () => {
  const { s, sA, sB, r1, e1 } = build();
  for (const a of [
    { type: "move", id: sA.id, at: { parentId: "page", index: 0 } },
    { type: "move", id: sA.id, at: { parentId: "page", index: 1 } },
    { type: "move", id: r1.id, at: { parentId: sA.id, index: 0 } },
    { type: "move", id: r1.id, at: { parentId: sA.id, index: 1 } },
    { type: "move", id: e1.id, at: { parentId: r1.cols[0].id, index: 0 } },
    { type: "move", id: sB.id, at: { parentId: sA.id, index: 0 } }, // wrong kind
    { type: "move", id: "ghost", at: { parentId: "page", index: 0 } },
    { type: "moveUp", id: sA.id },
    { type: "moveDown", id: sB.id },
  ] as Action[]) assert.equal(run(s, a), s);
});

test("move reorders (index is pre-removal) and across parents; undo restores exactly", () => {
  const { s, sA, sB } = build();
  const down = run(s, { type: "move", id: sA.id, at: { parentId: "page", index: 2 } });
  assert.deepEqual(down.page.sections.map((x) => x.id), [sB.id, sA.id]);
  const up = run(down, { type: "moveUp", id: sA.id });
  assert.deepEqual(up.page.sections.map((x) => x.id), [sA.id, sB.id]);
  const dn = run(s, { type: "moveDown", id: sA.id });
  assert.deepEqual(dn.page.sections.map((x) => x.id), [sB.id, sA.id]);
  const r2 = s.page.sections[0].rows[1];
  const moved = run(s, { type: "move", id: r2.id, at: { parentId: sB.id, index: 0 } });
  assert.equal(moved.page.sections[1].rows[0].id, r2.id);
  assert.equal(moved.page.sections[0].rows.length, 1);
  const undone = reduce(moved, { type: "undo" });
  assert.deepEqual(undone.page, s.page);
  assert.deepEqual(reduce(undone, { type: "redo" }).page, moved.page);
});

test("a section can move into a popup and back", () => {
  const b = build();
  let s = run(b.s, { type: "addPopup", name: "Offer", trigger: "timer" });
  const pid = `popup:${s.page.popups[0].id}`;
  s = run(s, { type: "move", id: b.sA.id, at: { parentId: pid, index: 0 } });
  assert.equal(findPath(s.page, b.sA.id)?.parentId, pid);
  s = run(s, { type: "move", id: b.sA.id, at: { parentId: "page", index: 0 } });
  assert.equal(findPath(s.page, b.sA.id)?.parentId, "page");
});

test("duplicate deep-copies with fresh ids, right after the original", () => {
  const { s, sA } = build();
  const d = run(s, { type: "duplicate", id: sA.id });
  assert.equal(d.page.sections.length, 3);
  const copy = d.page.sections[1];
  assert.equal(d.sel, copy.id);
  const ids = (x: unknown) => JSON.stringify(x).match(/"id":"[^"]+"/g)!;
  const orig = d.page.sections[0];
  assert.equal(ids(copy).length, ids(orig).length);
  assert.equal(new Set([...ids(copy), ...ids(orig)]).size, ids(copy).length * 2);
});

test("remove clears the selection of a removed subtree; columns refuse removal", () => {
  const { s, sA, r1 } = build(); // sel = e2 inside sA
  assert.equal(run(s, { type: "remove", id: r1.cols[0].id }), s);
  const r = run(s, { type: "remove", id: sA.id });
  assert.equal(r.sel, null);
  assert.equal(r.page.sections.length, 1);
  const other = run({ ...s, sel: sA.id }, { type: "remove", id: s.page.sections[1].id });
  assert.equal(other.sel, sA.id);
  assert.equal(run(s, { type: "remove", id: "ghost" }), s);
});

test("update merges a patch but never touches id, kind or children", () => {
  const { s, sA, e1 } = build();
  const u = run(s, { type: "update", id: sA.id, patch: { bg: "#000", id: "x", rows: [], kind: "el" } });
  const n = findPath(u.page, sA.id)!.node as typeof sA;
  assert.equal(n.bg, "#000");
  assert.equal(n.rows.length, 2);
  const el = run(s, { type: "update", id: e1.id, patch: { name: "Hero" } });
  assert.equal(findPath(el.page, e1.id)!.node.name, "Hero");
  assert.equal(run(s, { type: "update", id: e1.id, patch: { id: "z" } }), s);
  assert.equal(run(s, { type: "update", id: "ghost", patch: { name: "a" } }), s);
});

test("setRowPreset grows with empty columns and shrinks keeping elements in order", () => {
  const { s, r1, e1, e2 } = build();
  const g = run(s, { type: "setRowPreset", id: r1.id, preset: "4" });
  const grown = findPath(g.page, r1.id)!.node as Row;
  assert.equal(grown.cols.length, 4);
  assert.deepEqual(grown.cols.slice(0, 2).map((c) => c.id), r1.cols.map((c) => c.id));
  assert.equal(grown.cols[3].els.length, 0);
  const sh = run(s, { type: "setRowPreset", id: r1.id, preset: "1" });
  const shrunk = findPath(sh.page, r1.id)!.node as Row;
  assert.deepEqual(shrunk.cols[0].els.map((e) => e.id), [e1.id, e2.id]);
  assert.equal(run(s, { type: "setRowPreset", id: r1.id, preset: "2" }), s);
  run(s, { type: "setRowPreset", id: r1.id, preset: "1/3+2/3" });
});

test("popups: add, update, remove (clears selection inside it)", () => {
  let s = run(initState(empty), { type: "addPopup", name: "Exit", trigger: "exit" });
  const pid = s.page.popups[0].id;
  s = run(s, { type: "updatePopup", id: pid, patch: { trigger: "timer", delaySec: 5, id: "no" } as never });
  assert.equal(s.page.popups[0].id, pid);
  assert.equal(s.page.popups[0].delaySec, 5);
  const sec = makeSection();
  s = run(s, { type: "insert", kind: "sec", node: sec, at: { parentId: `popup:${pid}`, index: 0 } });
  assert.equal(s.sel, sec.id);
  s = run(s, { type: "removePopup", id: pid });
  assert.equal(s.sel, null);
  assert.equal(run(s, { type: "removePopup", id: pid }), s);
});

test("insert refuses wrong kind, duplicate id and unknown parent", () => {
  const { s, sA, e1 } = build();
  assert.equal(run(s, { type: "insert", kind: "row", node: makeRow(), at: { parentId: "page", index: 0 } }), s);
  assert.equal(run(s, { type: "insert", kind: "sec", node: sA, at: { parentId: "page", index: 0 } }), s);
  assert.equal(run(s, { type: "insert", kind: "el", node: e1, at: { parentId: "ghost", index: 0 } }), s);
  assert.equal(run(s, { type: "insert", kind: "sec", node: makeRow(), at: { parentId: "page", index: 0 } }), s);
});

test("select leaves history alone; history is capped at 100 and mutation clears redo", () => {
  let s = initState(empty);
  assert.equal(reduce(s, { type: "select", id: "x" }).past.length, 0);
  for (let i = 0; i < 105; i++) s = reduce(s, { type: "insert", kind: "sec", node: makeSection(), at: { parentId: "page", index: 0 } });
  assert.equal(s.past.length, HISTORY_LIMIT);
  s = reduce(s, { type: "undo" });
  assert.equal(s.future.length, 1);
  s = reduce(s, { type: "insert", kind: "sec", node: makeSection(), at: { parentId: "page", index: 0 } });
  assert.equal(s.future.length, 0);
  assert.equal(reduce(initState(empty), { type: "undo" }).past.length, 0);
});

test("removePopup resets buttons that opened it, in one history step", () => {
  let s = run(initState(empty), { type: "addPopup", name: "Exit", trigger: "button" });
  const pid = s.page.popups[0].id;
  const b = makeElement("button");
  (b.props as Record<string, unknown>).action = "popup";
  (b.props as Record<string, unknown>).popupId = pid;
  const sec = makeSection();
  const rw = makeRow("1");
  s = run(s, { type: "insert", kind: "sec", node: sec, at: { parentId: "page", index: 0 } });
  s = run(s, { type: "insert", kind: "row", node: rw, at: { parentId: sec.id, index: 0 } });
  s = run(s, { type: "insert", kind: "el", node: b, at: { parentId: rw.cols[0].id, index: 0 } });
  const before = s.past.length;
  s = run(s, { type: "removePopup", id: pid });
  assert.equal(s.past.length, before + 1);
  const p = (findPath(s.page, b.id)!.node as { props: Record<string, unknown> }).props;
  assert.equal(p.action, "form");
  assert.equal(p.popupId, "");
});

test("node ids must be plain tokens", () => {
  const bad = (id: string) => pageSchema.safeParse({ version: 2, sections: [{ ...makeSection(), id }], popups: [] }).success;
  assert.equal(bad(makeSection().id), true);
  assert.equal(bad("a.b"), false);
  assert.equal(bad("popup:x"), false);
});
