// One React renderer for the page tree: used by publish (renderPageHtml) and by
// the editor canvas (forEditor: adds data-node-id for selection). Client-safe:
// no sanitiser here. Rich fields are rendered as given; renderPageHtml runs
// sanitizePage first. All styling is by class (see css.ts), never inline.
import React from "react";
import type { Column, Element, Page, Popup, Row, Section } from "../tree.ts";
import { cls } from "./css.ts";

const h = React.createElement;

export type ViewCtx = {
  steps: { id: string; path: string }[];
  pageId: string;
  forEditor?: boolean;
  site?: unknown;
};

const rich = (html: string) => ({ dangerouslySetInnerHTML: { __html: html } });
const P = (e: Element) => e.props as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ICONS: Record<string, string> = {
  check: "✓", star: "★", heart: "♥", arrow: "→", phone: "☎", mail: "✉",
  pin: "\u{1F4CD}", clock: "⏱", calendar: "\u{1F4C5}", gift: "\u{1F381}",
};
const NETWORKS: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn", tiktok: "TikTok", x: "X", whatsapp: "WhatsApp",
};

// Only YouTube / Vimeo links become an embed (the publish cleaner allows those hosts).
export function embedUrl(url: string): string | null {
  const yt = /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,20})/i.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{4,12})/i.exec(url);
  return vm ? `https://player.vimeo.com/video/${vm[1]}` : null;
}

function href(e: Element, page: Page, ctx: ViewCtx): { href: string; action: string } {
  const p = P(e);
  switch (p.action) {
    case "form": {
      const f = findForm(page);
      return { href: f ? `#${f}` : "#", action: "form" };
    }
    case "next": {
      const i = ctx.steps.findIndex((s) => s.id === ctx.pageId);
      return { href: (i >= 0 && ctx.steps[i + 1]?.path) || "#", action: "next" };
    }
    case "popup":
      return { href: "#", action: `popup:${p.popupId ?? ""}` };
    default:
      return { href: p.url || "#", action: "url" };
  }
}

function findForm(page: Page): string | null {
  for (const s of page.sections)
    for (const r of s.rows) for (const c of r.cols) for (const e of c.els) if (e.type === "form" || e.type === "order") return e.id;
  return null;
}

const mockForm = (label: string) =>
  h("div", { className: "e-form" },
    ["Full name", "Email", "Phone (WhatsApp)"].map((l) => h("label", { key: l }, l, h("span", { className: "inp" }))),
    h("span", { className: "chk" }, "I agree to receive marketing messages."),
    h("span", { className: "sub" }, label));

function body(e: Element, page: Page, ctx: ViewCtx): React.ReactNode {
  const p = P(e);
  switch (e.type) {
    case "headline": return h("h2", { className: "t", ...rich(p.text) });
    case "sub": return h("h3", { className: "t", ...rich(p.text) });
    case "para": return h("p", { className: "t", ...rich(p.text) });
    case "list":
      return h("ul", { className: "e-list" }, p.items.map((i: string, k: number) => h("li", { key: k, ...rich(i) })));
    case "button": {
      const a = href(e, page, ctx);
      return h("div", { className: "ba" },
        h("a", { className: "btn t", href: a.href, "data-action": a.action }, p.text, p.sub ? h("small", null, p.sub) : null));
    }
    case "image": {
      const img = p.src ? h("img", { src: p.src, alt: p.alt, loading: "lazy" }) : h("div", { className: "e-img", role: "img", "aria-label": p.alt });
      return h("div", { className: "im" }, p.link ? h("a", { href: p.link }, img) : img);
    }
    case "video": {
      const u = embedUrl(p.url);
      return h("div", { className: "e-vid" }, u ? h("iframe", { src: u, title: "Video", loading: "lazy", allowFullScreen: true }) : null);
    }
    case "form":
    case "order":
      return h("div", {
        "data-lead": e.type, "data-id": e.id, "data-settings": JSON.stringify(p.settings), "data-button": p.button,
      }, ctx.forEditor ? mockForm(p.button) : null);
    case "faq":
      return h("div", { className: "e-faq" }, p.items.map(([q, a]: [string, string], k: number) =>
        h("details", { key: k }, h("summary", rich(q)), h("p", rich(a)))));
    case "countdown":
      return h("div", { className: "e-cd", "data-cd": p.to, "data-done": p.doneText },
        ["days", "hours", "min", "sec"].map((u) => h("div", { key: u }, h("b", null, "--"), h("span", null, u))));
    case "divider": return h("div", { className: "e-div" });
    case "icon-text":
      return h("div", { className: "e-it" }, h("span", { className: "ic", "aria-hidden": "true" }, ICONS[p.icon] ?? "•"), h("p", { className: "t", ...rich(p.text) }));
    case "social":
      return h("div", { className: "e-soc" }, p.items.map((s: { network: string; url: string }, k: number) =>
        h("a", { key: k, href: s.url || "#" }, NETWORKS[s.network] ?? s.network)));
    case "logos":
      return h("div", { className: "e-logos" }, p.items.map((i: { src: string; alt: string }, k: number) => h("img", { key: k, src: i.src, alt: i.alt, loading: "lazy" })));
    case "counter":
      return h("div", { className: "e-ct" },
        h("b", null, p.prefix, h("span", { "data-count": String(p.to) }, String(p.to)), p.suffix),
        h("div", null, p.label));
    case "slider":
      return h("div", { className: "e-sl", ...(p.autoplay ? { "data-autoplay": "1" } : {}) },
        p.items.map((i: { src: string; alt: string }, k: number) => h("img", { key: k, src: i.src, alt: i.alt, loading: "lazy" })));
    case "nav":
      return h("nav", { className: "e-nav" }, p.items.map((i: { label: string; href: string }, k: number) => h("a", { key: k, href: i.href || "#" }, i.label)));
  }
  return null;
}

const node = (n: { id: string }, ctx: ViewCtx) => (ctx.forEditor ? { "data-node-id": n.id } : {});
const anim = (a: string) => (a !== "none" ? { "data-anim": a } : {});

function El({ e, page, ctx }: { e: Element; page: Page; ctx: ViewCtx }) {
  return h("div", { className: `el ${cls(e.id)}`, ...node(e, ctx), ...anim(e.anim) }, body(e, page, ctx));
}
function Col({ c, page, ctx }: { c: Column; page: Page; ctx: ViewCtx }) {
  return h("div", { className: `col ${cls(c.id)}`, ...node(c, ctx) }, c.els.map((e) => h(El, { key: e.id, e, page, ctx })));
}
function RowV({ r, page, ctx }: { r: Row; page: Page; ctx: ViewCtx }) {
  return h("div", { className: `row ${cls(r.id)}`, ...node(r, ctx) }, r.cols.map((c) => h(Col, { key: c.id, c, page, ctx })));
}
function Sec({ s, page, ctx }: { s: Section; page: Page; ctx: ViewCtx }) {
  const hide = (["d", "t", "m"] as const).filter((k) => s.hideOn[k]).map((k) => `hide-${k}`);
  return h("section", { className: ["sec", cls(s.id), ...hide].join(" "), ...node(s, ctx), ...anim(s.anim) },
    h("div", { className: "wrap" }, s.rows.map((r) => h(RowV, { key: r.id, r, page, ctx }))));
}
function PopupV({ p, page, ctx }: { p: Popup; page: Page; ctx: ViewCtx }) {
  return h("div", {
    "data-lead": "popup", "data-id": p.id, "data-trigger": p.trigger,
    ...(p.delaySec != null ? { "data-delay": String(p.delaySec) } : {}), hidden: true,
  }, h("div", { className: "lp" }, p.sections.map((s) => h(Sec, { key: s.id, s, page, ctx }))));
}

export function PageView({ page, ctx }: { page: Page; ctx: ViewCtx }) {
  return h(React.Fragment, null,
    h("div", { className: "lp" }, page.sections.map((s) => h(Sec, { key: s.id, s, page, ctx }))),
    page.popups.map((p) => h(PopupV, { key: p.id, p, page, ctx })));
}
