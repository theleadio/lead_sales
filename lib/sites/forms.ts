import { db } from "../sql.ts";
import { trimUrl } from "../crm/attribution.ts";
import { fbcFrom, queueCapi } from "./capi.ts";
import { crmLead, type CrmLeadInput } from "./crm-api.ts";
import { PUBLIC_HOST } from "./host.ts";
import { formNameFor, leadFormSettingsSchema, pageSlug, siteSettingsSchema, type LeadFormSettings } from "./model.ts";
import { components } from "./publish.ts";
import { landingAndAttribution, whatsappFallback } from "./public-request.ts";
import { isUuid } from "./stats.ts";

export type FormRaw = {
  pageId: string;
  formId: string;
  fullName: string;
  email: string;
  phone: string;
  companyName?: string;
  jobTitle?: string;
  message?: string;
  consentMarketing: boolean;
  idempotencyKey: string;
  captchaToken?: string;
  firstTouch?: string;
  lastTouch?: string;
  landingUrl: string;
  referrer: string | null;
  fbp?: string;
  userAgent?: string;
};

export type FormResult =
  | { kind: "ok"; after: Exclude<LeadFormSettings["after"], { kind: "step" }> | { kind: "step"; path: string } }
  | { kind: "invalid"; fields: Record<string, string> }
  | { kind: "limited" }
  | { kind: "captcha" }
  | { kind: "not_found" }
  | { kind: "error"; whatsapp: string | null };

// Creates the lead through lead_crm's public API. Everything that shapes the
// lead (form name, deal, course) comes from the PUBLISHED page's form element,
// never from the request.
export async function submitForm(
  raw: FormRaw,
  ctx: { clientIp: string | null; crm?: typeof crmLead },
): Promise<FormResult> {
  if (!isUuid(raw.pageId)) return { kind: "not_found" };
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(raw.idempotencyKey)) return { kind: "invalid", fields: { idempotencyKey: "invalid" } };
  const [page] = await db()`
    SELECT p.path, s.settings, v.html
    FROM sales.site_page p JOIN sales.site s ON s.id = p.site_id
    JOIN sales.page_version v ON v.id = p.active_version_id AND v.status = 'published'
    WHERE p.id = ${raw.pageId} AND s.domain = ${PUBLIC_HOST}`;
  if (!page) return { kind: "not_found" };
  const form = components(page.html ?? "", "form").find((c) => c.id === raw.formId);
  const parsed = leadFormSettingsSchema.safeParse(form?.settings);
  if (!form || !parsed.success) return { kind: "not_found" };
  const f = parsed.data;
  const site = siteSettingsSchema.safeParse(page.settings);

  const { landing, q, attribution } = landingAndAttribution(page.path, raw);

  const input: CrmLeadInput = {
    idempotencyKey: raw.idempotencyKey,
    formName: formNameFor(f, pageSlug(page.path)),
    fullName: raw.fullName,
    email: raw.email,
    phone: raw.phone,
    companyName: f.fields.includes("company") ? raw.companyName : undefined,
    jobTitle: f.fields.includes("jobTitle") ? raw.jobTitle : undefined,
    message: f.fields.includes("message") ? raw.message : undefined,
    preferredLanguage: f.workshop?.language,
    courseInterest: f.courseCode,
    classCode: f.classCode,
    consentMarketing: raw.consentMarketing,
    captchaToken: raw.captchaToken,
    createDeal: f.createDeal,
    attribution,
  };
  const r = await (ctx.crm ?? crmLead)(input, { clientIp: ctx.clientIp });
  if (r.kind === "error") {
    return { kind: "error", whatsapp: whatsappFallback(page.settings) };
  }
  if (r.kind !== "ok") return r;

  if (site.success && site.data.capi) {
    const fbclid = q.get("fbclid");
    const now = new Date();
    try {
      await queueCapi("Lead", {
        eventId: `lead:${raw.idempotencyKey}`,
        eventTime: now,
        sourceUrl: trimUrl(landing.href) ?? landing.href,
        fbc: fbclid ? fbcFrom(fbclid, now.getTime()) : undefined,
        fbp: raw.fbp,
        email: raw.email,
        phone: raw.phone,
        consent: raw.consentMarketing,
        clientIp: ctx.clientIp ?? undefined,
        userAgent: raw.userAgent,
      });
    } catch {
      console.error("site-form: capi queue failed"); // the lead exists; never fail the visitor over it
    }
  }
  // A step target becomes that step's live path on this site; a step that
  // is not published (or not on this site) falls back to the message kind.
  if (f.after.kind === "step") {
    const [t] = await db()`
      SELECT p.path FROM sales.site_page p
      WHERE p.id::text = ${f.after.pageId} AND p.site_id = (SELECT site_id FROM sales.site_page WHERE id = ${raw.pageId})
        AND p.active_version_id IS NOT NULL`;
    return { kind: "ok", after: t ? { kind: "step", path: t.path as string } : { kind: "message", text: "" } };
  }
  return { kind: "ok", after: f.after };
}
