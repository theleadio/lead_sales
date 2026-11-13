import { db } from "../sql.ts";
import { attributionPayload, parseTouch, touchFrom, trimUrl } from "../crm/attribution.ts";
import { fbcFrom, queueCapi } from "./capi.ts";
import { crmLead, type CrmLeadInput } from "./crm-api.ts";
import { PUBLIC_HOST } from "./host.ts";
import { formNameFor, leadFormSettingsSchema, pageSlug, siteSettingsSchema, type LeadFormSettings } from "./model.ts";
import { components } from "./publish.ts";
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
  | { kind: "ok"; after: LeadFormSettings["after"] }
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

  const first = parseTouch(raw.firstTouch);
  const last = parseTouch(raw.lastTouch) ?? touchFrom(raw.landingUrl, raw.referrer);
  let q = new URLSearchParams();
  try {
    q = new URL(raw.landingUrl).searchParams;
  } catch {}
  const attribution = {
    ...attributionPayload(first, last),
    landingUrl: trimUrl(raw.landingUrl), // the page the form is on, which the stats match on
    utmId: q.get("utm_id")?.slice(0, 200) || null,
    utmAdId: q.get("utm_ad_id")?.slice(0, 200) || null,
  } as NonNullable<CrmLeadInput["attribution"]>;

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
    const wa = site.success ? site.data.chatWidget?.whatsapp.replace(/\D/g, "") : "";
    return { kind: "error", whatsapp: wa ? `https://wa.me/${wa}` : null };
  }
  if (r.kind !== "ok") return r;

  if (site.success && site.data.capi) {
    const fbclid = q.get("fbclid");
    const now = new Date();
    try {
      await queueCapi("Lead", {
        eventId: `lead:${raw.idempotencyKey}`,
        eventTime: now,
        sourceUrl: trimUrl(raw.landingUrl) ?? `https://${PUBLIC_HOST}${page.path}`,
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
  return { kind: "ok", after: f.after };
}
