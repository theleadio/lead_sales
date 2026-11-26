import { z } from "zod";
import { FONTS } from "./fonts.ts";
import { isRealDate, workshopFormName } from "./workshop-name.ts";

export { workshopFormName };

// Same rule as the route path CHECK in the DB: "/" or 1-5 kebab segments.
export const pathSchema = z
  .string()
  .regex(/^\/([a-z0-9]+(-[a-z0-9]+)*)(\/[a-z0-9]+(-[a-z0-9]+)*){0,4}$|^\/$/);

export function normalizePath(input: string): string {
  const p = input.trim().toLowerCase().replace(/\/+/g, "/").replace(/\/$/, "");
  return p === "" ? "/" : p;
}

// https only: blocks javascript:, data:, http: from ever being stored.
const httpsUrl = z
  .string()
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an https:// URL");

// WhatsApp widget holds a phone number (digits, optional leading +, 8-15 digits),
// not a URL; the widget builds the wa.me link itself.
const whatsappNumber = z.string().regex(/^\+?\d{8,15}$/, "must be a phone number");

// Site-wide look (editor Typography / Background flyouts). Optional in stored
// settings; pageCss falls back to DEFAULT_THEME.
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "must be a #rrggbb colour");
export const themeSchema = z.object({
  headFont: z.enum(FONTS),
  bodyFont: z.enum(FONTS),
  text: hex,
  link: hex,
  bg: hex,
});
export type Theme = z.infer<typeof themeSchema>;
export const DEFAULT_THEME: Theme = { headFont: "Inter", bodyFont: "Inter", text: "#111827", link: "#2563eb", bg: "#ffffff" };

export const siteSettingsSchema = z.object({
  theme: themeSchema.optional(),
  favicon: httpsUrl.optional(),
  pixels: z.object({
    meta: z.string().optional(),
    google: z.string().optional(),
    linkedin: z.string().optional(),
    tiktok: z.string().optional(),
  }),
  capi: z.boolean(),
  chatWidget: z.object({ whatsapp: whatsappNumber }).optional(),
  paymentMode: z.enum(["live", "test"]),
  seo: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    image: httpsUrl.optional(),
    noindex: z.boolean().optional(),
  }),
  privacyUrl: httpsUrl.optional(),
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

// Extra questions a form or order block can ask on top of the standard ones.
//   text    : one line            choice  : pick one of `options`
//   multi   : tick any of `options`   address : a few lines
//   pax     : a head count (whole number 1-500)
// Answers reach the CRM as "Label: answer" lines in the message. A choice may
// also name the option that means "company funds it through HRDC"; picking it
// sets the lead's hrdcIntended flag.
const RESERVED_KEYS = ["fullName", "email", "phone", "companyName", "jobTitle", "message", "classCode", "consentMarketing"];
export const customFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,29}$/, "use letters and digits, starting with a letter"),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["text", "choice", "multi", "address", "pax"]),
    options: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    required: z.boolean().optional(),
    hrdcOption: z.string().max(100).optional(),
  })
  .superRefine((f, ctx) => {
    if (RESERVED_KEYS.includes(f.key)) ctx.addIssue({ code: "custom", path: ["key"], message: "this name is already used by a standard field" });
    const o = f.options ?? [];
    if (f.kind === "choice" || f.kind === "multi") {
      if (o.length < (f.kind === "choice" ? 2 : 1)) ctx.addIssue({ code: "custom", path: ["options"], message: "add at least two options" });
      if (new Set(o).size !== o.length) ctx.addIssue({ code: "custom", path: ["options"], message: "options must be different" });
    } else if (o.length) ctx.addIssue({ code: "custom", path: ["options"], message: "only choice fields have options" });
    if (f.hrdcOption && !(f.kind === "choice" && o.includes(f.hrdcOption))) {
      ctx.addIssue({ code: "custom", path: ["hrdcOption"], message: "must be one of the options of a choice field" });
    }
  });
export type CustomField = z.infer<typeof customFieldSchema>;

const customFields = z
  .array(customFieldSchema)
  .max(10)
  .optional()
  .refine((a) => !a || new Set(a.map((f) => f.key)).size === a.length, "each extra question needs its own name");

export const leadFormSettingsSchema = z
  .object({
  type: z.enum(["workshop", "interest", "enquiry"]),
  workshop: z
    .object({
      title: z.string().min(1),
      date: z.string().refine(isRealDate, "must be a real YYYY-MM-DD date"),
      language: z.enum(["en", "zh"]),
    })
    .optional(),
  formName: z.string().optional(),
  courseCode: z.string().optional(),
  classCode: z.string().optional(),
  fields: z.array(z.enum(["company", "jobTitle", "message"])),
  custom: customFields,
  createDeal: z.boolean(),
  after: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("message"), text: z.string() }),
    z.object({ kind: z.literal("step"), pageId: z.string() }),
    z.object({ kind: z.literal("url"), url: httpsUrl }),
  ]),
  })
  .superRefine((s, ctx) => {
    if (s.type === "workshop" && !s.workshop) {
      ctx.addIssue({ code: "custom", path: ["workshop"], message: "required for workshop forms" });
    }
  });
export type LeadFormSettings = z.infer<typeof leadFormSettingsSchema>;

// An order block sells one class (`classCode`) or, when `classCodes` is set,
// lets the visitor pick one of several intakes of the same checkout; then
// `classCode` is ignored. Every code must be a CRM class code (publish checks).
export const orderFormSettingsSchema = z.object({
  classCode: z.string(),
  classCodes: z.array(z.string().max(60)).max(12).optional(),
  askCompany: z.boolean(),
  custom: customFields,
});
export type OrderFormSettings = z.infer<typeof orderFormSettingsSchema>;

// The class codes an order block offers, as stored (blank entries kept so the
// publish check can refuse them).
export const orderClassCodes = (s: Pick<OrderFormSettings, "classCode" | "classCodes">): string[] =>
  (s.classCodes?.length ? s.classCodes : [s.classCode]).map((c) => c.trim());

export function formNameFor(s: LeadFormSettings, pageSlug: string): string {
  if (s.type === "workshop" && s.workshop) {
    return workshopFormName(s.workshop.title, s.workshop.date);
  }
  return s.formName?.trim() || `page:${pageSlug}`;
}

// Page slug used in generated form names: the path without its leading slash,
// "home" for "/".
export const pageSlug = (path: string): string => (path === "/" ? "home" : path.slice(1));
