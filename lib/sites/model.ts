import { z } from "zod";
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

export const siteSettingsSchema = z.object({
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

export const orderFormSettingsSchema = z.object({
  classCode: z.string(),
  askCompany: z.boolean(),
});
export type OrderFormSettings = z.infer<typeof orderFormSettingsSchema>;

export function formNameFor(s: LeadFormSettings, pageSlug: string): string {
  if (s.type === "workshop" && s.workshop) {
    return workshopFormName(s.workshop.title, s.workshop.date);
  }
  return s.formName?.trim() || `page:${pageSlug}`;
}

// Page slug used in generated form names: the path without its leading slash,
// "home" for "/".
export const pageSlug = (path: string): string => (path === "/" ? "home" : path.slice(1));
