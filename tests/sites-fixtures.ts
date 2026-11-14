// v2 page-tree fixtures for the sites tests (not a test file).
import { defaultProps, newId } from "../lib/sites/tree.ts";
import { db } from "../lib/sql.ts";

export const el = (type: string, props?: Record<string, unknown>, id = newId("e")) => ({
  id, kind: "el", type, name: type, anim: "none",
  box: { mt: 0, mb: 0, pt: 0, pr: 0, pb: 0, pl: 0, bg: "", radius: 0 },
  props: { ...(defaultProps(type as never) as object), ...props },
});
export const col = (els: unknown[] = []) => ({ id: newId("c"), kind: "col", name: "c", pad: { t: 0, r: 0, b: 0, l: 0 }, bg: "", radius: 0, els });
export const row = (cols: unknown[], preset = String(cols.length)) => ({
  id: newId("r"), kind: "row", name: "r", preset, gap: { d: 24 }, mt: 0, mb: 0, valign: "start", cols,
});
export const sec = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  id: newId("s"), kind: "sec", name: "s", width: "wide", bg: "#ffffff", pt: { d: 64 }, pb: { d: 64 },
  hideOn: { d: false, t: false, m: false }, anim: "none", rows, ...over,
});
export const page = (sections: unknown[], popups: unknown[] = []) => ({ version: 2, sections, popups });
// A page with the given elements in one column.
export const pageOf = (...els: unknown[]) => page([sec([row([col(els)])])]);

export const setDraftTree = (pageId: string, p: unknown) =>
  db()`UPDATE sales.page_version SET project = ${db().json(p as never)}, html = '', css = '' WHERE page_id = ${pageId} AND status = 'draft'`;

// Shorthand for the common cases.
export const paraPage = (text: string) => pageOf(el("para", { text }));
export const formPage = (id: string, settings: unknown, button = "Go") => pageOf(el("form", { settings, button }, id));
export const orderPage = (id: string, settings: unknown) => pageOf(el("order", { settings, button: "Pay" }, id));
