// Small builder DSL for recreating the SalesProcess (GoHighLevel) landing pages
// as v2 funnel pages. Everything here produces plain page-tree JSON that the
// editor can open and change afterwards; nothing is special-cased at render.
import { makeElement, makeRow, makeSection } from "../../lib/sites/editor-state.ts";
import type { ElementType, R } from "../../lib/sites/elements.ts";
import type { CustomField } from "../../lib/sites/model.ts";
import type { Element, Page, Preset, Section } from "../../lib/sites/tree.ts";

// ---- LEAD course-page look (measured on ai.thelead.io, 25 Nov 2026) ----------
export const C = {
  ink: "#141a16", // headings
  body: "#3d3d3d",
  pale: "#f4f7f9", // rgba(210,224,229,.25) on white
  dark: "#1b2421", // form + footer band
  purple: "#5442a5", // "Trusted by" heading, plan names
  yellow: "#fbe33b",
  green: "#16a34a",
  white: "#ffffff",
  card: "#ffffff",
  slate: "#d2dbe2", // self-funded price chip
  amber: "#fcd34d", // HRDC price chip
  lilac: "#ddd6fe", // coaching price chip
};

const r = (d: number, m?: number, t?: number): R => ({ d, ...(t != null ? { t } : {}), ...(m != null ? { m } : {}) });

type Box = Partial<Element["box"]>;
type ElOpts = { box?: Box; anim?: Element["anim"]; name?: string };
const el = (type: ElementType, props: Record<string, unknown>, o: ElOpts = {}): Element => {
  const e = makeElement(type);
  return {
    ...e,
    name: o.name ?? type,
    anim: o.anim ?? "none",
    box: { ...e.box, ...o.box },
    props: { ...(e.props as object), ...props },
  };
};

type Align = "left" | "center" | "right";
type TextOpts = ElOpts & { align?: Align; color?: string; size?: R; weight?: number };

export const h1 = (text: string, o: TextOpts = {}) =>
  el("headline", { text, size: o.size ?? r(44, 30), weight: o.weight ?? 800, align: o.align ?? "left", color: o.color ?? C.ink, font: "hf" }, o);
export const h2 = (text: string, o: TextOpts = {}) =>
  el("headline", { text, size: o.size ?? r(30, 24), weight: o.weight ?? 700, align: o.align ?? "center", color: o.color ?? C.ink, font: "hf" }, o);
export const h3 = (text: string, o: TextOpts = {}) =>
  el("sub", { text, size: o.size ?? r(20, 18), weight: o.weight ?? 700, align: o.align ?? "left", color: o.color ?? C.ink, font: "hf" }, o);
export const p = (text: string, o: TextOpts = {}) =>
  el("para", { text, size: o.size ?? r(16, 15), weight: o.weight ?? 400, align: o.align ?? "left", color: o.color ?? C.body, font: "cf" }, o);
export const ul = (items: string[], o: ElOpts & { color?: string; size?: R } = {}) =>
  el("list", { items, size: o.size ?? r(16, 15), color: o.color ?? C.body }, o);
export const img = (src: string, alt = "", o: ElOpts & { align?: Align; link?: string } = {}) =>
  el("image", { src, alt, link: o.link ?? "", align: o.align ?? "center" }, o);
// A fixed-height picture (icons, badges): the logos element is the only one with a height control.
export const icon = (src: string, alt: string, height: number, o: ElOpts = {}) =>
  el("logos", { items: [{ src, alt }], height: r(height) }, o);
export const logos = (srcs: string[], height: number, o: ElOpts & { marquee?: boolean; speed?: number } = {}) =>
  el(
    "logos",
    { items: srcs.map((src) => ({ src, alt: "Logo" })), height: r(height, Math.round(height * 0.75)), ...(o.marquee ? { marquee: true, speed: o.speed ?? 60 } : {}) },
    o,
  );
// Another page shown in a sandboxed frame (the live page only; it must allow framing).
export const embed = (url: string, title: string, height = 480, o: ElOpts = {}) => el("embed", { mode: "url", url, html: "", height, title }, o);
export const btn = (
  text: string,
  to: { url: string } | { form: true } | { next: true },
  o: ElOpts & { sub?: string; bg?: string; fg?: string; align?: Align; full?: boolean; size?: number } = {},
) =>
  el(
    "button",
    {
      text,
      sub: o.sub ?? "",
      action: "url" in to ? "url" : "form" in to ? "form" : "next",
      url: "url" in to ? to.url : "",
      bg: o.bg ?? C.yellow,
      fg: o.fg ?? C.ink,
      size: r(o.size ?? 18),
      align: o.align ?? "center",
      full: o.full ?? false,
    },
    o,
  );
export const faq = (items: [string, string][], o: ElOpts = {}) => el("faq", { items }, o);
export const counter = (to: number, suffix: string, label: string, o: ElOpts & { color?: string } = {}) =>
  el("counter", { to, prefix: "", suffix, label, size: r(44, 34), color: o.color ?? C.ink }, o);
export const nav = (items: [string, string][], o: ElOpts & { color?: string; align?: Align } = {}) =>
  el("nav", { items: items.map(([label, href]) => ({ label, href })), align: o.align ?? "right", color: o.color ?? C.ink }, o);
export const divider = (color = "#e5e7eb", o: ElOpts = {}) => el("divider", { color, thickness: 1 }, o);
export const slider = (srcs: string[], o: ElOpts = {}) =>
  el("slider", { items: srcs.map((src) => ({ src, alt: "" })), autoplay: true }, o);
export const social = (items: [string, string][], o: ElOpts & { align?: Align } = {}) =>
  el("social", { items: items.map(([network, url]) => ({ network, url })), align: o.align ?? "left", size: r(16) }, o);
export const leadForm = (settings: Record<string, unknown>, button: string, o: ElOpts = {}) => el("form", { settings, button }, o);
export const orderForm = (classCode: string, button: string, askCompany = false, o: ElOpts & { custom?: CustomField[] } = {}) =>
  el("order", { settings: { classCode, askCompany, ...(o.custom?.length ? { custom: o.custom } : {}) }, button }, o);
// One checkout offering several intakes; the visitor picks. A blank code keeps
// publishing blocked until that class exists in the CRM.
export const orderIntakes = (classCodes: string[], button: string, askCompany = false, o: ElOpts & { custom?: CustomField[] } = {}) =>
  el("order", { settings: { classCode: "", classCodes, askCompany, ...(o.custom?.length ? { custom: o.custom } : {}) }, button }, o);

// "Self-funded or HRDC": picking the HRDC answer flags the lead as HRDC-intended.
export const HRDC_SELF = "Self-funded";
export const HRDC_CLAIM = "Company-sponsored (HRDC claimable)";
export const fundingField = (lang: "en" | "zh" = "en"): CustomField =>
  lang === "zh"
    ? { key: "funding", label: "付款方式", kind: "choice", options: ["自费", "公司赞助（HRDC 可申请）"], hrdcOption: "公司赞助（HRDC 可申请）", required: true }
    : { key: "funding", label: "How will the fee be paid?", kind: "choice", options: [HRDC_SELF, HRDC_CLAIM], hrdcOption: HRDC_CLAIM, required: true };

// ---- layout -----------------------------------------------------------------
export type ColSpec = Element[] | { els: Element[]; bg?: string; radius?: number; pad?: number | [number, number, number, number] };
type RowOpts = { gap?: number; valign?: "start" | "center" | "end"; mt?: number; mb?: number };
export const row = (preset: Preset, cols: ColSpec[], o: RowOpts = {}) => {
  const rw = makeRow(preset);
  if (cols.length !== rw.cols.length) throw new Error(`row ${preset} needs ${rw.cols.length} columns, got ${cols.length}`);
  return {
    ...rw,
    gap: r(o.gap ?? 24, Math.min(o.gap ?? 24, 16)),
    valign: o.valign ?? "start",
    mt: o.mt ?? 0,
    mb: o.mb ?? 0,
    cols: rw.cols.map((c, i) => {
      const s = cols[i];
      if (Array.isArray(s)) return { ...c, els: s };
      const pd = typeof s.pad === "number" ? [s.pad, s.pad, s.pad, s.pad] : (s.pad ?? [0, 0, 0, 0]);
      return { ...c, els: s.els, bg: s.bg ?? "", radius: s.radius ?? 0, pad: { t: pd[0], r: pd[1], b: pd[2], l: pd[3] } };
    }),
  };
};
export const one = (...els: Element[]) => row("1", [els]);

type SecOpts = { name: string; anchor?: string; width?: Section["width"]; bg?: string; bgImage?: string; pt?: number; pb?: number; hide?: "d" | "m" };
export const sec = (o: SecOpts, ...rows: ReturnType<typeof row>[]): Section => {
  const s = makeSection(o.width ?? "wide");
  return {
    ...s,
    name: o.name,
    ...(o.anchor ? { anchor: o.anchor } : {}),
    bg: o.bg ?? "",
    ...(o.bgImage ? { bgImage: o.bgImage } : {}),
    pt: r(o.pt ?? 64, Math.round((o.pt ?? 64) * 0.65)),
    pb: r(o.pb ?? 64, Math.round((o.pb ?? 64) * 0.65)),
    hideOn: { d: o.hide === "d", t: false, m: o.hide === "m" },
    rows,
  };
};
export const card = (els: Element[], bg = C.card, pad = 24): ColSpec => ({ els, bg, radius: 16, pad });

export const pageOf = (...sections: Section[]): Page => ({ version: 2, sections, popups: [] });

// ---- funnel spec --------------------------------------------------------------
export type StepSpec = { name: string; kind: "page" | "checkout" | "thank_you"; path: string; page: Page };
export type FunnelSpec = {
  slug: string; // file name for previews / SQL
  name: string;
  folder: string;
  language: "en" | "zh";
  basePath: string;
  source: string[]; // the SalesProcess URLs this replaces
  settings: Record<string, unknown>;
  steps: StepSpec[];
  notes: string[]; // gaps and things to check, reported to the person
};

// Image links: the GHL CDN serves the same file at assets.cdn.filesafe.space.
export const M = (id: string) => `https://assets.cdn.filesafe.space/szVYTdKpbjBJvbLHEDmm/media/${id}`;
