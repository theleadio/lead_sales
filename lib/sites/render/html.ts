// Server-side: page tree -> html string for publish and preview.
import React from "react";
import type { Page } from "../tree.ts";
import { parsePage, sanitizePage } from "../tree-server.ts";
import { PageView, type ViewCtx } from "./view.ts";

import { pageCss } from "./css.ts";
export { pageCss };
export { PageView } from "./view.ts";

// Static serialiser for the element tree. Not react-dom/server: Next refuses to
// bundle it in server code (server actions, routes), and the components in
// view.ts are plain function components with no hooks, so walking the elements
// is enough. Same escaping rules as renderToStaticMarkup.
const VOID = new Set(["img", "br", "hr", "input", "meta", "link"]);
const ATTR: Record<string, string> = { className: "class", allowFullScreen: "allowfullscreen" };
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serialize(n: any): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return esc(String(n));
  if (Array.isArray(n)) return n.map(serialize).join("");
  const { type, props } = n;
  if (typeof type === "function") return serialize(type(props));
  if (type === React.Fragment) return serialize(props.children);
  let attrs = "";
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (k === "children" || k === "dangerouslySetInnerHTML" || v == null || v === false) continue;
    attrs += ` ${ATTR[k] ?? k}="${v === true ? "" : esc(String(v))}"`;
  }
  if (VOID.has(type)) return `<${type}${attrs}/>`;
  const inner = props.dangerouslySetInnerHTML ? String(props.dangerouslySetInnerHTML.__html) : serialize(props.children);
  return `<${type}${attrs}>${inner}</${type}>`;
}

// Sanitises the rich fields again before rendering (defence in depth).
export function renderPageHtml(page: Page, ctx: Omit<ViewCtx, "forEditor">): string {
  return serialize(React.createElement(PageView, { page: sanitizePage(page), ctx }));
}

// Draft project -> html + css. A brand-new draft ({}) is an empty page; any
// other non-v2 project (old editor data) is refused.
export function renderDraft(
  project: unknown,
  ctx: Omit<ViewCtx, "forEditor">,
): { ok: true; html: string; css: string } | { ok: false; message: string } {
  const isEmpty = project == null || (typeof project === "object" && Object.keys(project).length === 0);
  const r = isEmpty ? { ok: true as const, page: { version: 2 as const, sections: [], popups: [] } } : parsePage(project);
  if (!r.ok) return { ok: false, message: `This page cannot be published: ${r.message}` };
  return { ok: true, html: renderPageHtml(r.page, ctx), css: pageCss(r.page, ctx.site) };
}
