// Page CSS: one class per node id, desktop rules first, then tablet
// (max-width:991px) and phone (max-width:575px) overrides from responsive R
// values. A phone value falls back to tablet, then desktop, by cascade alone:
// the tablet rule also applies at phone width unless a phone rule overrides it.
import { FONTS } from "../fonts.ts";
import { DEFAULT_THEME, type Theme } from "../model.ts";
import type { Page, Section, R } from "../tree.ts";

export const TABLET_MAX = 991;
export const PHONE_MAX = 575;
// Class for a node id (ids are free text up to 80 chars; keep the class safe).
export const cls = (id: string): string => "x" + id.replace(/[^\w-]/g, "_");

const SEC_WIDTH = { full: "100%", wide: "1140px", medium: "820px", small: "560px" } as const;
const FLEX: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };

// Colours reach CSS: allow named colours, hex, rgb()/hsl() and var(--x) only.
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d\s.,%/-]+\)|var\(--[\w-]+\))$/i;
const color = (v: string | undefined): string | null => (v && COLOR.test(v.trim()) ? v.trim() : null);
const n = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const STATIC = `.lp{--hf:Inter,system-ui,sans-serif;--cf:Inter,system-ui,sans-serif;--tc:#111827;--lc:#2563eb;color:var(--tc);font-family:var(--cf);font-size:16px;line-height:1.5}
.lp *,.lp *::before,.lp *::after{box-sizing:border-box}
.lp h2,.lp h3{font-family:var(--hf);margin:0;line-height:1.15;text-wrap:balance}
.lp p{margin:0}.lp a{color:var(--lc)}
.lp .sec{padding-left:24px;padding-right:24px}
.lp .wrap{margin:0 auto;display:grid;gap:20px}
.lp .row{display:grid}
.lp .col{display:flex;flex-direction:column;gap:14px;min-width:0}
.lp .el{min-width:0}
.lp .btn{display:inline-flex;flex-direction:column;align-items:center;border-radius:10px;padding:14px 28px;font-weight:700;font-family:var(--hf);text-decoration:none}
.lp .btn small{font-weight:500;font-size:12px;opacity:.85}
.lp .im{display:flex}.lp .im img,.lp .e-img{max-width:100%;border-radius:12px}
.lp .e-img{width:100%;aspect-ratio:16/10;background:#e5e7eb}
.lp .e-list{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.lp .e-list li{display:flex;gap:10px;align-items:flex-start}
.lp .e-list li::before{content:"\\2713";flex:none;width:20px;height:20px;border-radius:50%;background:#16a34a;color:#fff;font-size:12px;display:grid;place-items:center;margin-top:2px}
.lp .e-form{display:grid;gap:10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;padding:20px}
.lp .e-form label{display:grid;gap:4px;font-size:14px;font-weight:600}
.lp .e-form .inp{height:44px;border:1px solid #d1d5db;border-radius:8px;background:#fff}
.lp .e-form .chk{font-size:13px}
.lp .e-form .sub{height:48px;border-radius:10px;background:#111827;color:#fff;display:grid;place-items:center;font-weight:700}
.lp .e-faq{display:grid;gap:8px}
.lp .e-faq details{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;background:#fff}
.lp .e-faq summary{font-weight:700;cursor:pointer}.lp .e-faq p{margin-top:6px}
.lp .e-cd{display:flex;gap:10px;justify-content:center}
.lp .e-cd div{min-width:64px;background:#111827;color:#fff;border-radius:10px;padding:10px;text-align:center;font-variant-numeric:tabular-nums}
.lp .e-cd b{display:block;font:800 26px var(--hf)}
.lp .e-cd span{font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:.06em}
.lp .e-div{height:1px;background:#e5e7eb;width:100%}
.lp .e-vid{position:relative;aspect-ratio:16/9;border-radius:12px;background:#0f172a;overflow:hidden}
.lp .e-vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.lp .e-it{display:flex;gap:10px;align-items:flex-start}.lp .e-it .ic{flex:none}
.lp .e-soc,.lp .e-nav{display:flex;flex-wrap:wrap;gap:8px 16px}
.lp .e-logos{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:center}
.lp .e-logos img{width:auto;max-width:100%}
.lp .e-ct{text-align:center}.lp .e-ct b{display:block;font:800 48px var(--hf);line-height:1.1}
.lp .e-sl{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px}
.lp .e-sl img{flex:0 0 100%;max-width:100%;scroll-snap-align:center;border-radius:12px}
@media (min-width:${TABLET_MAX + 1}px){.lp .hide-d{display:none!important}}
@media (min-width:${PHONE_MAX + 1}px) and (max-width:${TABLET_MAX}px){.lp .hide-t{display:none!important}}
@media (max-width:${PHONE_MAX}px){.lp .hide-m{display:none!important}}`;

// Site theme -> CSS variables, text/link colours and the page background.
// Anything not a known font or #rrggbb colour falls back to the default.
export function themeCss(site?: unknown): string {
  const raw = ((site as { settings?: { theme?: Partial<Theme> } } | null | undefined)?.settings?.theme ?? {}) as Partial<Theme>;
  const font = (v: unknown, d: string) => ((FONTS as readonly string[]).includes(v as string) ? (v as string) : d);
  const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  const stack = (f: string) => `"${f}",system-ui,sans-serif`;
  const t = DEFAULT_THEME;
  return `.lp{--hf:${stack(font(raw.headFont, t.headFont))};--cf:${stack(font(raw.bodyFont, t.bodyFont))};--tc:${hex(raw.text, t.text)};--lc:${hex(raw.link, t.link)};background-color:${hex(raw.bg, t.bg)}}`;
}

export function pageCss(page: Page, site?: unknown): string {
  const d: string[] = [];
  const t: string[] = [];
  const m: string[] = [];
  const dec = (sel: string, ...decls: (string | null)[]) => {
    const body = decls.filter(Boolean).join(";");
    if (body) d.push(`${sel}{${body}}`);
  };
  const resp = (sel: string, prop: string, r: R | undefined) => {
    if (!r || !n(r.d)) return;
    d.push(`${sel}{${prop}:${r.d}px}`);
    if (n(r.t)) t.push(`${sel}{${prop}:${r.t}px}`);
    if (n(r.m)) m.push(`${sel}{${prop}:${r.m}px}`);
  };
  const px = (prop: string, v: unknown) => (n(v) && v !== 0 ? `${prop}:${v}px` : null);
  const col = (prop: string, v: string | undefined) => {
    const c = color(v);
    return c ? `${prop}:${c}` : null;
  };

  const element = (X: string, type: string, p: Record<string, unknown>) => {
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
    const r = (k: string) => p[k] as R | undefined;
    const al = () => FLEX[str("align") ?? "left"] ?? "flex-start";
    switch (type) {
      case "headline":
      case "sub":
      case "para":
        dec(
          `${X} .t`,
          `font-family:var(--${p.font === "cf" ? "cf" : "hf"})`,
          `font-weight:${Number(p.weight) || 400}`,
          `text-align:${FLEX[str("align") ?? ""] ? str("align") : "left"}`,
          col("color", str("color")),
        );
        resp(`${X} .t`, "font-size", r("size"));
        break;
      case "list":
        dec(`${X} .e-list`, col("color", str("color")));
        resp(`${X} .e-list`, "font-size", r("size"));
        break;
      case "button":
        dec(`${X} .ba`, "display:flex", `justify-content:${al()}`);
        dec(`${X} .btn`, col("background-color", str("bg")), col("color", str("fg")), p.full ? "width:100%" : null);
        resp(`${X} .btn`, "font-size", r("size"));
        break;
      case "image":
        dec(`${X} .im`, `justify-content:${al()}`);
        break;
      case "divider":
        dec(`${X} .e-div`, `height:${Number(p.thickness) || 1}px`, col("background-color", str("color")));
        break;
      case "icon-text":
        dec(`${X} .e-it`, col("color", str("color")));
        resp(`${X} .e-it`, "font-size", r("size"));
        break;
      case "social":
        dec(`${X} .e-soc`, `justify-content:${al()}`);
        resp(`${X} .e-soc`, "font-size", r("size"));
        break;
      case "logos":
        resp(`${X} .e-logos img`, "height", r("height"));
        break;
      case "counter":
        dec(`${X} .e-ct`, col("color", str("color")));
        resp(`${X} .e-ct b`, "font-size", r("size"));
        break;
      case "nav":
        dec(`${X} .e-nav`, `justify-content:${al()}`);
        dec(`${X} .e-nav a`, col("color", str("color")));
        break;
    }
  };

  const section = (s: Section) => {
    const S = ".lp ." + cls(s.id);
    dec(
      S,
      col("background-color", s.bg),
      s.bgImage
        ? `background-image:url("${encodeURI(s.bgImage).replace(/["()\\]/g, (c) => "%" + c.charCodeAt(0).toString(16))}");background-size:cover;background-position:center`
        : null,
    );
    dec(`${S} .wrap`, `max-width:${SEC_WIDTH[s.width]}`);
    resp(S, "padding-top", s.pt);
    resp(S, "padding-bottom", s.pb);
    for (const r of s.rows) {
      const R_ = ".lp ." + cls(r.id);
      const k = r.cols.length;
      const tpl = r.preset === "1/3+2/3" ? "1fr 2fr" : r.preset === "2/3+1/3" ? "2fr 1fr" : `repeat(${k},minmax(0,1fr))`;
      dec(R_, `grid-template-columns:${tpl}`, px("margin-top", r.mt), px("margin-bottom", r.mb), `align-items:${r.valign}`);
      resp(R_, "gap", r.gap);
      if (k >= 4 && !r.preset.includes("/")) t.push(`${R_}{grid-template-columns:repeat(${k >= 5 ? 3 : 2},minmax(0,1fr))}`);
      m.push(`${R_}{grid-template-columns:1fr}`); // phone always stacks
      for (const c of r.cols) {
        dec(
          `.lp .${cls(c.id)}`,
          px("padding-top", c.pad.t),
          px("padding-right", c.pad.r),
          px("padding-bottom", c.pad.b),
          px("padding-left", c.pad.l),
          col("background-color", c.bg),
          px("border-radius", c.radius),
        );
        for (const e of c.els) {
          const b = e.box;
          dec(
            `.lp .${cls(e.id)}`,
            px("margin-top", b.mt),
            px("margin-bottom", b.mb),
            px("padding-top", b.pt),
            px("padding-right", b.pr),
            px("padding-bottom", b.pb),
            px("padding-left", b.pl),
            col("background-color", b.bg),
            px("border-radius", b.radius),
          );
          element(`.lp .${cls(e.id)}`, e.type, e.props as Record<string, unknown>);
        }
      }
    }
  };

  page.sections.forEach(section);
  for (const p of page.popups) p.sections.forEach(section);
  return [STATIC, themeCss(site), ...d, `@media (max-width:${TABLET_MAX}px){${t.join("")}}`, `@media (max-width:${PHONE_MAX}px){${m.join("")}}`].join("\n");
}
