import { z } from "zod";
import { workshopFormName } from "./workshop-name.ts";

export { workshopFormName };

// Same rule as the route path CHECK in the DB: "/" or 1-5 kebab segments.
export const pathSchema = z
  .string()
  .regex(/^\/([a-z0-9]+(-[a-z0-9]+)*)(\/[a-z0-9]+(-[a-z0-9]+)*){0,4}$|^\/$/);

export function normalizePath(input: string): string {
  const p = input.trim().toLowerCase().replace(/\/+/g, "/").replace(/\/$/, "");
  return p === "" ? "/" : p;
}

export const siteSettingsSchema = z.object({
  favicon: z.string().optional(),
  pixels: z.object({
    meta: z.string().optional(),
    google: z.string().optional(),
    linkedin: z.string().optional(),
    tiktok: z.string().optional(),
  }),
  capi: z.boolean(),
  chatWidget: z.object({ whatsapp: z.string() }).optional(),
  paymentMode: z.enum(["live", "test"]),
  seo: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    noindex: z.boolean().optional(),
  }),
  privacyUrl: z.string().optional(),
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const leadFormSettingsSchema = z.object({
  type: z.enum(["workshop", "interest", "enquiry"]),
  workshop: z
    .object({
      title: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    z.object({ kind: z.literal("url"), url: z.string() }),
  ]),
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
