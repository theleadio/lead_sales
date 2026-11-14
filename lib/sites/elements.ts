// Per-type props schemas for page elements (what the settings panel edits).
import { z } from "zod";
import { leadFormSettingsSchema, orderFormSettingsSchema } from "./model.ts";

export const rSchema = z.object({
  d: z.number(),
  t: z.number().nullish(),
  m: z.number().nullish(),
});
export type R = z.infer<typeof rSchema>;

const align = z.enum(["left", "center", "right"]);
const color = z.string().max(40); // "" = inherit
const text = z.string().max(20_000);
const textProps = {
  text,
  size: rSchema,
  weight: z.number().int().min(100).max(900),
  align,
  color,
  font: z.enum(["hf", "cf"]),
};
// Empty, https:, mailto:, tel:, #anchor or a site-relative /path. Refuses
// javascript:, data:, http:, //host and /\host (browsers read that as //).
export const safeUrl = z
  .string()
  .max(2048)
  .refine((v) => v === "" || /^(https:|mailto:|tel:|#)/i.test(v) || /^\/(?![/\\])/.test(v), "unsafe URL");
const img = safeUrl; // image URL, "" = none
const url = safeUrl;
const imgItem = z.object({ src: img, alt: z.string().max(300) });

const schemas = {
  headline: z.object(textProps),
  sub: z.object(textProps),
  para: z.object(textProps),
  list: z.object({ items: z.array(z.string().max(2000)).max(100), size: rSchema, color }),
  button: z.object({
    text: z.string().max(200),
    sub: z.string().max(200),
    action: z.enum(["form", "next", "popup", "url"]),
    url,
    popupId: z.string().max(100).optional(),
    bg: color,
    fg: color,
    size: rSchema,
    align,
    full: z.boolean(),
  }),
  image: z.object({ src: img, alt: z.string().max(300), link: url, align }),
  video: z.object({ url }),
  form: z.object({ settings: leadFormSettingsSchema, button: z.string().max(200) }),
  order: z.object({ settings: orderFormSettingsSchema, button: z.string().max(200) }),
  faq: z.object({ items: z.array(z.tuple([z.string().max(500), z.string().max(5000)])).max(50) }),
  countdown: z.object({ to: z.string().max(40), doneText: z.string().max(200) }),
  divider: z.object({ color, thickness: z.number().min(1).max(20) }),
  "icon-text": z.object({ icon: z.string().max(40), text, color, size: rSchema }),
  social: z.object({
    items: z
      .array(z.object({ network: z.enum(["facebook", "instagram", "youtube", "linkedin", "tiktok", "x", "whatsapp"]), url }))
      .max(10),
    align,
    size: rSchema,
  }),
  logos: z.object({ items: z.array(imgItem).max(30), height: rSchema }),
  counter: z.object({
    to: z.number(),
    prefix: z.string().max(20),
    suffix: z.string().max(20),
    label: z.string().max(200),
    size: rSchema,
    color,
  }),
  slider: z.object({ items: z.array(imgItem).max(30), autoplay: z.boolean() }),
  nav: z.object({ items: z.array(z.object({ label: z.string().max(100), href: url })).max(20), align, color }),
};

export type ElementType = keyof typeof schemas;
export const ELEMENT_TYPES = Object.keys(schemas) as [ElementType, ...ElementType[]];
export const elementPropsSchema = (type: string) => schemas[type as ElementType];

const R1 = (d: number, m?: number): R => ({ d, m });
const defaults: Record<ElementType, () => unknown> = {
  headline: () => ({ text: "Your headline", size: R1(44, 30), weight: 800, align: "left", color: "", font: "hf" }),
  sub: () => ({ text: "Sub-headline", size: R1(22, 18), weight: 600, align: "left", color: "", font: "hf" }),
  para: () => ({ text: "Write something useful here.", size: R1(17, 16), weight: 400, align: "left", color: "", font: "cf" }),
  list: () => ({ items: ["First point", "Second point", "Third point"], size: R1(17), color: "" }),
  button: () => ({ text: "Sign up now", sub: "", action: "form", url: "", bg: "#facc15", fg: "#111827", size: R1(18), align: "left", full: false }),
  image: () => ({ src: "", alt: "", link: "", align: "center" }),
  video: () => ({ url: "" }),
  form: () => ({
    settings: { type: "interest", fields: [], createDeal: false, after: { kind: "message", text: "[Thank-you message]" } },
    button: "Save my seat",
  }),
  order: () => ({ settings: { classCode: "", askCompany: false }, button: "Pay now" }),
  faq: () => ({ items: [["[Question]", "[Placeholder answer]"]] }),
  countdown: () => ({ to: "", doneText: "" }),
  divider: () => ({ color: "#e5e7eb", thickness: 1 }),
  "icon-text": () => ({ icon: "check", text: "[Text]", color: "", size: R1(17) }),
  social: () => ({ items: [], align: "center", size: R1(24) }),
  logos: () => ({ items: [], height: R1(40) }),
  counter: () => ({ to: 0, prefix: "", suffix: "", label: "[Label]", size: R1(48, 36), color: "" }),
  slider: () => ({ items: [], autoplay: false }),
  nav: () => ({ items: [], align: "right", color: "" }),
};

export function defaultProps(type: ElementType): unknown {
  return structuredClone(defaults[type]());
}
