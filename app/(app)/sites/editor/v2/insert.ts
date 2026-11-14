// What the "+" menus, the Add flyout and the keyboard insert, and where.
// Library and prebuilt nodes are ALWAYS deep-copied with fresh ids (cloneFresh)
// because the reducer's `insert` does not re-key children.
import {
  cloneFresh, findPath, makeElement, makeRow, makeSection,
  type DropTarget, type Kind, type Node,
} from "@/lib/sites/editor-state";
import { ELEMENT_TYPES, type Element, type ElementType, type Page, type Preset, type Row, type Section } from "@/lib/sites/tree";

export const SECTION_WIDTHS = ["full", "wide", "medium", "small"] as const;
export const ROW_PRESETS: Preset[] = ["1", "2", "3", "4", "1/3+2/3", "2/3+1/3"];

export const ELEMENT_INFO: Record<ElementType, { label: string; glyph: string }> = {
  headline: { label: "Headline", glyph: "H" },
  sub: { label: "Sub-headline", glyph: "T" },
  para: { label: "Paragraph", glyph: "¶" },
  list: { label: "Bullet list", glyph: "☰" },
  button: { label: "Button", glyph: "▭" },
  image: { label: "Image", glyph: "▧" },
  video: { label: "Video", glyph: "▶" },
  form: { label: "LEAD form", glyph: "✉" },
  order: { label: "Order form", glyph: "🛒" },
  faq: { label: "FAQ", glyph: "?" },
  countdown: { label: "Countdown", glyph: "⏱" },
  divider: { label: "Divider", glyph: "―" },
  "icon-text": { label: "Icon + text", glyph: "★" },
  social: { label: "Social links", glyph: "@" },
  logos: { label: "Logo strip", glyph: "▦" },
  counter: { label: "Counter", glyph: "#" },
  slider: { label: "Image slider", glyph: "⇄" },
  nav: { label: "Menu", glyph: "≡" },
};
export const ELEMENT_LIST = ELEMENT_TYPES.map((t) => ({ type: t, ...ELEMENT_INFO[t] }));

export const presetLabel = (p: Preset) => (p.includes("/") ? p : `${p} column${p === "1" ? "" : "s"}`);
export const presetGlyph = (p: Preset) => "▮".repeat(p.includes("/") ? 2 : Number(p));

export const newElement = (t: ElementType) => ({ ...makeElement(t), name: ELEMENT_INFO[t].label });
export function newRow(p: Preset) {
  const r = makeRow(p);
  return { ...r, name: `${r.cols.length} Column Row` };
}
export const newSection = (width: Section["width"] = "wide"): Section => ({ ...makeSection(width), rows: [newRow("1")] });
/** Default names equal the kind ("Section"): show just that, else "Section · name" for sections. */
export function nodeLabel(n: Node): string {
  if (n.kind === "el") return n.name && n.name !== n.type ? n.name : ELEMENT_INFO[n.type].label;
  if (n.kind === "sec") return n.name === "Section" ? "Section" : `Section · ${n.name}`;
  return n.name;
}
/** One row (one column) holding el; and a section holding that row. Inserted whole = one undo step. */
export function rowWith(el: Element, preset: Preset = "1") {
  const r = newRow(preset);
  return { ...r, cols: r.cols.map((c, i) => (i === 0 ? { ...c, els: [el] } : c)) };
}
export const sectionWith = (row: Row, width: Section["width"] = "wide"): Section => ({ ...newSection(width), rows: [row] });
export const freshCopy = <T extends Node>(n: T): T => cloneFresh(n);

/** Nodes from the root of the page/popup down to `id` (popup ids are not nodes, so they drop out). */
export function chain(page: Page, id: string | null): Node[] {
  const f = id ? findPath(page, id) : null;
  return f ? (f.path.map((i) => findPath(page, i)?.node).filter(Boolean) as Node[]) : [];
}

const top = (popupId: string | null) => (popupId ? `popup:${popupId}` : "page");
const secsOf = (page: Page, popupId: string | null) => (popupId ? page.popups.find((p) => p.id === popupId)?.sections ?? [] : page.sections);

/** Where a new section goes: after `afterId` (or the selected item's section), else at the end. */
export function sectionTarget(page: Page, popupId: string | null, sel: string | null, afterId?: string | null): DropTarget {
  const secs = secsOf(page, popupId);
  const anchor = afterId ?? chain(page, sel)[0]?.id;
  const i = anchor ? secs.findIndex((s) => s.id === anchor) : -1;
  return { parentId: top(popupId), index: i >= 0 ? i + 1 : secs.length };
}

/** Where a new row goes from the flyout: end of the selected item's section, else of the last section. */
export function rowTarget(page: Page, popupId: string | null, sel: string | null): DropTarget | null {
  const s = (chain(page, sel)[0] as Section | undefined) ?? secsOf(page, popupId).at(-1);
  return s ? { parentId: s.id, index: s.rows.length } : null;
}

/** Where a new element goes from the flyout: after the selected element, end of the selected column, else a sensible column. */
export function elementTarget(page: Page, popupId: string | null, sel: string | null): DropTarget | null {
  const c = chain(page, sel);
  if (c.length === 4) return { parentId: c[2].id, index: (c[2] as { els: Node[] }).els.findIndex((e) => e.id === c[3].id) + 1 };
  if (c.length === 3) return { parentId: c[2].id, index: (c[2] as { els: Node[] }).els.length };
  const row = c.length === 2 ? (c[1] as { cols: { id: string; els: Node[] }[] }) : ((c[0] ?? secsOf(page, popupId).at(-1)) as Section | undefined)?.rows.at(-1);
  const col = row?.cols.at(-1);
  return col ? { parentId: col.id, index: col.els.length } : null;
}

/** "+" menu targets: after the node itself (section, row), or into/after in the column (column, element). */
export function plusTarget(page: Page, id: string, kind: Kind): DropTarget | null {
  const f = findPath(page, id);
  if (!f) return null;
  if (kind === "col") return { parentId: id, index: (f.node as { els: Node[] }).els.length };
  return { parentId: f.parentId, index: f.index + 1 };
}
