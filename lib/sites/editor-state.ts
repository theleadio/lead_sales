// Pure editor-state reducers (spec §3/§5). Client-importable: no node APIs.
// Pages are immutable - every edit copies the path it touches. A no-op action
// (invalid target, unknown id, move to the same position) returns the SAME
// state object and pushes no history.
import {
  defaultProps, newId, presetColumns,
  type Column, type Element, type ElementType, type Page, type Popup, type Preset, type Row, type Section,
} from "./tree.ts";

export type Kind = "sec" | "row" | "col" | "el";
export type Node = Section | Row | Column | Element;
export type EditorState = { page: Page; sel: string | null; past: Page[]; future: Page[] };
// parentId: 'page' = top-level sections, 'popup:<id>' = that popup's sections,
// otherwise a section id (rows), row id (cols) or column id (elements).
// index is the insertion position in the list BEFORE any removal: moving a
// node within its own list to index === its position or position + 1 is a no-op.
export type DropTarget = { parentId: string; index: number };

export type Action =
  | { type: "select"; id: string | null }
  | { type: "insert"; kind: Kind; node: Node; at: DropTarget }
  | { type: "move"; id: string; at: DropTarget }
  | { type: "moveUp"; id: string }
  | { type: "moveDown"; id: string }
  | { type: "remove"; id: string }
  | { type: "duplicate"; id: string }
  | { type: "update"; id: string; patch: Record<string, unknown> }
  | { type: "setRowPreset"; id: string; preset: Preset }
  | { type: "addPopup"; name: string; trigger: Popup["trigger"] }
  | { type: "updatePopup"; id: string; patch: Partial<Omit<Popup, "id" | "sections">> }
  | { type: "removePopup"; id: string }
  | { type: "undo" }
  | { type: "redo" };

export const HISTORY_LIMIT = 100;
const CAP = { page: 200, popup: 20, sec: 100, row: 6, col: 200, el: 0 } as const; // schema max per list

export const initState = (page: Page): EditorState => ({ page, sel: null, past: [], future: [] });

// ---- factories (UI + library build nodes; insert takes them ready-made) ----
export const makeColumn = (): Column => ({
  id: newId("c"), kind: "col", name: "Column", pad: { t: 0, r: 0, b: 0, l: 0 }, bg: "", radius: 0, els: [],
});
export const makeRow = (preset: Preset = "1"): Row => ({
  id: newId("r"), kind: "row", name: "Row", preset, gap: { d: 24 }, mt: 0, mb: 0, valign: "start",
  cols: Array.from({ length: presetColumns(preset) }, makeColumn),
});
export const makeSection = (width: Section["width"] = "wide"): Section => ({
  id: newId("s"), kind: "sec", name: "Section", width, bg: "", pt: { d: 64 }, pb: { d: 64 },
  hideOn: { d: false, t: false, m: false }, anim: "none", rows: [],
});
export const makeElement = (type: ElementType): Element => ({
  id: newId("e"), kind: "el", type, name: type, anim: "none",
  box: { mt: 0, mb: 0, pt: 0, pr: 0, pb: 0, pl: 0, bg: "", radius: 0 },
  props: defaultProps(type),
});

// ---- lookup ----
export type Found = { node: Node; kind: Kind; parentId: string; index: number; path: string[] };

const kidsOf = (n: Node): Node[] | null =>
  n.kind === "sec" ? n.rows : n.kind === "row" ? n.cols : n.kind === "col" ? n.els : null;

export function findPath(page: Page, id: string): Found | null {
  const hit = (list: Node[], parentId: string, trail: string[]): Found | null => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const path = [...trail, n.id];
      if (n.id === id) return { node: n, kind: n.kind, parentId, index: i, path };
      const kids = kidsOf(n);
      const f = kids && hit(kids, n.id, path);
      if (f) return f;
    }
    return null;
  };
  const top = hit(page.sections, "page", []);
  if (top) return top;
  for (const p of page.popups) {
    const f = hit(p.sections, `popup:${p.id}`, [p.id]);
    if (f) return f;
  }
  return null;
}

const PARENT_OF: Record<string, Kind | "page"> = { s: "sec", r: "row", c: "col" };
function parentKind(parentId: string, page?: Page): Kind | "page" | null {
  if (parentId === "page") return "page";
  if (parentId.startsWith("popup:")) return !page || page.popups.some((p) => `popup:${p.id}` === parentId) ? "page" : null;
  if (page) return findPath(page, parentId)?.kind ?? null;
  return PARENT_OF[parentId[0]] ?? null; // no page given: fall back to the newId prefix
}
const CHILD: Record<string, Kind> = { page: "sec", sec: "row", row: "col", col: "el" };

/** Can a node of `kind` be dropped into `target`? Columns never move on their own. Pass `page` for an exact parent check. */
export function validTarget(kind: Kind, target: DropTarget, page?: Page): boolean {
  if (kind === "col") return false;
  const pk = parentKind(target.parentId, page);
  return !!pk && CHILD[pk] === kind && Number.isInteger(target.index) && target.index >= 0;
}

// ---- immutable list editing ----
type L = any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
function editSecs(secs: Section[], pid: string, fn: (l: L) => L): Section[] | null {
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    let ns: Section | null = null;
    if (s.id === pid) ns = { ...s, rows: fn(s.rows) };
    else {
      for (let j = 0; j < s.rows.length && !ns; j++) {
        const r = s.rows[j];
        let nr: Row | null = null;
        if (r.id === pid) nr = { ...r, cols: fn(r.cols) };
        else {
          const k = r.cols.findIndex((c) => c.id === pid);
          if (k >= 0) nr = { ...r, cols: r.cols.map((c, m) => (m === k ? { ...c, els: fn(c.els) } : c)) };
        }
        if (nr) ns = { ...s, rows: s.rows.map((x, m) => (m === j ? nr! : x)) };
      }
    }
    if (ns) return secs.map((x, m) => (m === i ? ns! : x));
  }
  return null;
}
function editList(page: Page, pid: string, fn: (l: L) => L): Page | null {
  if (pid === "page") return { ...page, sections: fn(page.sections) };
  if (pid.startsWith("popup:")) {
    const i = page.popups.findIndex((p) => `popup:${p.id}` === pid);
    if (i < 0) return null;
    return { ...page, popups: page.popups.map((p, m) => (m === i ? { ...p, sections: fn(p.sections) } : p)) };
  }
  const top = editSecs(page.sections, pid, fn);
  if (top) return { ...page, sections: top };
  for (let i = 0; i < page.popups.length; i++) {
    const s = editSecs(page.popups[i].sections, pid, fn);
    if (s) return { ...page, popups: page.popups.map((p, m) => (m === i ? { ...p, sections: s } : p)) };
  }
  return null;
}
const listLen = (page: Page, pid: string): number | null => {
  let n: number | null = null;
  editList(page, pid, (l) => ((n = l.length), l));
  return n;
};
const capOf = (page: Page, pid: string): number => {
  const pk = parentKind(pid, page);
  if (pk === "page") return pid === "page" ? CAP.page : CAP.popup;
  return pk ? CAP[pk] : 0;
};

function cloneFresh<T extends Node>(n: T): T {
  const c = structuredClone(n) as Node;
  const walk = (x: Node) => {
    x.id = newId(x.kind === "sec" ? "s" : x.kind === "row" ? "r" : x.kind === "col" ? "c" : "e");
    kidsOf(x)?.forEach(walk);
  };
  walk(c);
  return c as T;
}

// ---- reducer ----
const commit = (s: EditorState, page: Page, sel: string | null = s.sel): EditorState => ({
  page, sel, past: [...s.past, s.page].slice(-HISTORY_LIMIT), future: [],
});

function moveTo(s: EditorState, id: string, at: DropTarget): EditorState {
  const from = findPath(s.page, id);
  if (!from || !validTarget(from.kind, at, s.page)) return s;
  const len = listLen(s.page, at.parentId);
  if (len === null) return s;
  let index = Math.min(at.index, len);
  if (from.parentId === at.parentId) {
    if (index === from.index || index === from.index + 1) return s; // own position: no-op
    if (index > from.index) index -= 1; // list shrinks by one once the node is lifted out
  } else if (len >= capOf(s.page, at.parentId)) return s;
  const removed = editList(s.page, from.parentId, (l) => l.filter((_, i) => i !== from.index));
  const placed = removed && editList(removed, at.parentId, (l) => [...l.slice(0, index), from.node, ...l.slice(index)]);
  return placed ? commit(s, placed) : s;
}

export function reduce(s: EditorState, a: Action): EditorState {
  switch (a.type) {
    case "select":
      return a.id === s.sel ? s : { ...s, sel: a.id };

    case "insert": {
      if (a.node.kind !== a.kind || !validTarget(a.kind, a.at, s.page) || findPath(s.page, a.node.id)) return s;
      const len = listLen(s.page, a.at.parentId);
      if (len === null || len >= capOf(s.page, a.at.parentId)) return s;
      const i = Math.min(a.at.index, len);
      const page = editList(s.page, a.at.parentId, (l) => [...l.slice(0, i), a.node, ...l.slice(i)]);
      return page ? commit(s, page, a.node.id) : s;
    }

    case "move":
      return moveTo(s, a.id, a.at);
    case "moveUp":
    case "moveDown": {
      const f = findPath(s.page, a.id);
      if (!f) return s;
      return moveTo(s, a.id, { parentId: f.parentId, index: a.type === "moveUp" ? f.index - 1 : f.index + 2 });
    }

    case "remove": {
      const f = findPath(s.page, a.id);
      // columns come from the row preset; removing one would break the schema
      if (!f || f.kind === "col") return s;
      const page = editList(s.page, f.parentId, (l) => l.filter((_, i) => i !== f.index));
      if (!page) return s;
      return commit(s, page, s.sel !== null && !findPath(page, s.sel) ? null : s.sel);
    }

    case "duplicate": {
      const f = findPath(s.page, a.id);
      if (!f || f.kind === "col") return s;
      const len = listLen(s.page, f.parentId);
      if (len === null || len >= capOf(s.page, f.parentId)) return s;
      const copy = cloneFresh(f.node);
      const page = editList(s.page, f.parentId, (l) => [...l.slice(0, f.index + 1), copy, ...l.slice(f.index + 1)]);
      return page ? commit(s, page, copy.id) : s;
    }

    case "update": {
      const f = findPath(s.page, a.id);
      if (!f) return s;
      const locked = new Set(["id", "kind", "rows", "cols", "els", ...(f.kind === "row" ? ["preset"] : [])]);
      const patch = Object.fromEntries(Object.entries(a.patch).filter(([k]) => !locked.has(k)));
      if (!Object.keys(patch).length) return s;
      const page = editList(s.page, f.parentId, (l) => l.map((n, i) => (i === f.index ? { ...n, ...patch } : n)));
      return page ? commit(s, page) : s;
    }

    case "setRowPreset": {
      const f = findPath(s.page, a.id);
      if (!f || f.kind !== "row" || (f.node as Row).preset === a.preset) return s;
      const row = f.node as Row;
      const n = presetColumns(a.preset);
      let cols: Column[];
      if (n >= row.cols.length) cols = [...row.cols, ...Array.from({ length: n - row.cols.length }, makeColumn)];
      else {
        const spill = row.cols.slice(n).flatMap((c) => c.els);
        cols = row.cols.slice(0, n).map((c, i) => (i === n - 1 ? { ...c, els: [...c.els, ...spill] } : c));
      }
      const page = editList(s.page, f.parentId, (l) => l.map((r, i) => (i === f.index ? { ...row, preset: a.preset, cols } : r)));
      return page ? commit(s, page) : s;
    }

    case "addPopup": {
      if (s.page.popups.length >= 20) return s;
      const popup: Popup = { id: newId("p"), name: a.name, trigger: a.trigger, sections: [] };
      return commit(s, { ...s.page, popups: [...s.page.popups, popup] });
    }
    case "updatePopup": {
      if (!s.page.popups.some((p) => p.id === a.id)) return s;
      const { id: _i, sections: _s, ...patch } = a.patch as Record<string, unknown>;
      return commit(s, { ...s.page, popups: s.page.popups.map((p) => (p.id === a.id ? { ...p, ...patch } : p)) });
    }
    case "removePopup": {
      if (!s.page.popups.some((p) => p.id === a.id)) return s;
      const page = { ...s.page, popups: s.page.popups.filter((p) => p.id !== a.id) };
      return commit(s, page, s.sel && !findPath(page, s.sel) ? null : s.sel);
    }

    case "undo": {
      if (!s.past.length) return s;
      const page = s.past[s.past.length - 1];
      return { page, sel: s.sel && findPath(page, s.sel) ? s.sel : null, past: s.past.slice(0, -1), future: [s.page, ...s.future].slice(0, HISTORY_LIMIT) };
    }
    case "redo": {
      if (!s.future.length) return s;
      const page = s.future[0];
      return { page, sel: s.sel && findPath(page, s.sel) ? s.sel : null, past: [...s.past, s.page].slice(-HISTORY_LIMIT), future: s.future.slice(1) };
    }
  }
}
