// Page model (spec §3): Page > Section > Row > Column > Element. The nesting
// is fixed by the schema, so no other shape can be saved.
import { z } from "zod";
import { elementPropsSchema, ELEMENT_TYPES, rSchema, safeUrl, type ElementType } from "./elements.ts";

export { ELEMENT_TYPES, elementPropsSchema, defaultProps, safeUrl, type R, type ElementType } from "./elements.ts";

export const MAX_PROJECT_BYTES = 1_500_000;
export const MAX_SECTIONS = 200;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const name = z.string().max(120);
const color = z.string().max(40);
const anim = z.enum(["none", "fade", "up", "left", "zoom"]);

export const PRESETS = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "1/3+2/3": 2, "2/3+1/3": 2 } as const;
export type Preset = keyof typeof PRESETS;
export const presetColumns = (preset: Preset): number => PRESETS[preset];

const elementSchema = z
  .object({
    id,
    kind: z.literal("el"),
    type: z.enum(ELEMENT_TYPES),
    name,
    anim,
    box: z.object({
      mt: z.number(), mb: z.number(), pt: z.number(), pr: z.number(), pb: z.number(), pl: z.number(),
      bg: color, radius: z.number(),
    }),
    props: z.unknown(),
  })
  .transform((e, ctx) => {
    const r = elementPropsSchema(e.type)?.safeParse(e.props);
    if (!r?.success) {
      ctx.issues.push({
        code: "custom",
        message: `props for ${e.type}: ${r?.error.issues[0]?.message ?? "unknown type"}`,
        input: e.props,
        path: ["props"],
      });
      return z.NEVER;
    }
    return { ...e, props: r.data as unknown }; // parsed: unknown keys stripped
  });

const columnSchema = z.object({
  id,
  kind: z.literal("col"),
  name,
  pad: z.object({ t: z.number(), r: z.number(), b: z.number(), l: z.number() }),
  bg: color,
  radius: z.number(),
  els: z.array(elementSchema).max(200),
});

const rowSchema = z
  .object({
    id,
    kind: z.literal("row"),
    name,
    preset: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]),
    gap: rSchema,
    mt: z.number(),
    mb: z.number(),
    valign: z.enum(["start", "center", "end"]),
    cols: z.array(columnSchema).max(6),
  })
  .refine((r) => r.cols.length === presetColumns(r.preset), { message: "column count must match preset", path: ["cols"] });

const sectionSchema = z.object({
  id,
  kind: z.literal("sec"),
  name,
  width: z.enum(["full", "wide", "medium", "small"]),
  bg: color,
  bgImage: safeUrl.optional(),
  pt: rSchema,
  pb: rSchema,
  hideOn: z.object({ d: z.boolean(), t: z.boolean(), m: z.boolean() }),
  anim,
  rows: z.array(rowSchema).max(100),
});

const popupSchema = z.object({
  id,
  name,
  trigger: z.enum(["exit", "timer", "button"]),
  delaySec: z.number().min(0).max(600).optional(),
  sections: z.array(sectionSchema).max(20),
});

export const pageSchema = z
  .object({
    version: z.literal(2),
    sections: z.array(sectionSchema).max(MAX_SECTIONS),
    popups: z.array(popupSchema).max(20),
  })
  .superRefine((page, ctx) => {
    const seen = new Set<string>();
    const dup = (id: string) => {
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `duplicate id ${id}`, path: ["sections"] });
      seen.add(id);
    };
    const walk = (s: z.infer<typeof sectionSchema>) => {
      dup(s.id);
      for (const r of s.rows) {
        dup(r.id);
        for (const c of r.cols) {
          dup(c.id);
          for (const e of c.els) dup(e.id);
        }
      }
    };
    page.sections.forEach(walk);
    for (const p of page.popups) {
      dup(p.id);
      p.sections.forEach(walk);
    }
  });

export type Page = z.infer<typeof pageSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Row = z.infer<typeof rowSchema>;
export type Column = z.infer<typeof columnSchema>;
export type Element = z.infer<typeof elementSchema>;
export type Popup = z.infer<typeof popupSchema>;

export const newId = (prefix: "s" | "r" | "c" | "e" | "p"): string =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;


// Which element props hold rich HTML (sanitised with sanitizeRich on save and
// rendered as HTML). Every other string - button text, alt, labels, names - is
// plain text and must never be sanitised or rendered as HTML.
//   "text"  : the prop `text`
//   "items" : every entry of `items` (list), every question and answer (faq)
export const RICH_FIELDS: Partial<Record<ElementType, "text" | "items">> = {
  headline: "text",
  sub: "text",
  para: "text",
  "icon-text": "text",
  list: "items",
  faq: "items",
};
