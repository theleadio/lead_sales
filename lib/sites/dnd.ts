// Drop-target maths for drag and drop in the editor (pure; the DOM wiring is
// app/(app)/sites/editor/v2/DragDrop.ts). Given what the pointer is over and
// its Y, find where the dragged kind would land and where to draw the line.
// Rects are in whatever space the caller measures in (the canvas iframe viewport).
import { findPath, validTarget, type DropTarget, type Kind, type Node } from "./editor-state.ts";
import type { Page } from "./tree.ts";

export type Rect = { left: number; top: number; width: number; height: number };
export type Drop = { target: DropTarget; line: { x: number; y: number; w: number }; label: string };

type Lists = { parentId: string; items: Node[]; name: string };

const LABEL: Partial<Record<Kind, string>> = { sec: "Drop section here", row: "Drop row here", el: "Drop element here" };
// The line sits a little off the sibling edge: rows and elements have gaps.
const GAP: Partial<Record<Kind, number>> = { sec: 0, row: 6, el: 4 };

/** The container (a list of siblings) a `kind` would be dropped into, given the hovered node. */
function container(page: Page, popupId: string | null, kind: Kind, hoveredId: string): Lists | null {
  const hit = findPath(page, hoveredId);
  if (!hit) return null;
  if (kind === "sec") {
    const pop = popupId ? page.popups.find((p) => p.id === popupId) : null;
    if (popupId && !pop) return null;
    return { parentId: pop ? `popup:${pop.id}` : "page", items: pop ? pop.sections : page.sections, name: "" };
  }
  const want: Kind = kind === "row" ? "sec" : "col";
  const holder = hit.path.map((i) => findPath(page, i)?.node).find((n) => n?.kind === want);
  if (!holder) return null;
  const items = holder.kind === "sec" ? holder.rows : holder.kind === "col" ? holder.els : [];
  return { parentId: holder.id, items, name: holder.name };
}

/**
 * kind: what is being dragged. fromId: its id when moving an existing node (it is ignored
 * when picking the gap, and dropping on its own position gives null). hoveredId: the
 * data-node-id under the pointer. y: pointer Y in rect space.
 */
export function dropTarget(
  page: Page, popupId: string | null, kind: Kind, fromId: string | null,
  hoveredId: string | null, y: number, rectOf: (id: string) => Rect | null,
): Drop | null {
  if (!hoveredId || kind === "col") return null;
  const c = container(page, popupId, kind, hoveredId);
  if (!c) return null;
  const others = c.items.filter((n) => n.id !== fromId);
  let at = others.length; // slot among `others`
  for (let i = 0; i < others.length; i++) {
    const r = rectOf(others[i].id);
    if (r && y < r.top + r.height / 2) {
      at = i;
      break;
    }
  }
  // Index in the full list (counted before any removal, as the reducer wants).
  const index = at < others.length ? c.items.indexOf(others[at]) : c.items.length;
  const target: DropTarget = { parentId: c.parentId, index };
  if (!validTarget(kind, target, page)) return null;
  const from = fromId ? findPath(page, fromId) : null;
  if (from && from.parentId === target.parentId && (index === from.index || index === from.index + 1)) return null;

  const gap = GAP[kind] ?? 0;
  const ref = others[Math.min(at, others.length - 1)];
  const r = (ref && rectOf(ref.id)) || rectOf(c.parentId.startsWith("popup:") || c.parentId === "page" ? hoveredId : c.parentId);
  if (!r) return null;
  const ly = !ref ? r.top + r.height / 2 : at >= others.length ? r.top + r.height + gap : r.top - gap;
  return { target, line: { x: r.left, y: ly, w: Math.max(40, r.width) }, label: LABEL[kind] ?? "Drop here" };
}
