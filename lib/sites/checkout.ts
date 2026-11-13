import { db } from "../sql.ts";
import { trimUrl } from "../crm/attribution.ts";
import { fbcFrom, queueCapi } from "./capi.ts";
import { crmRegister, type CrmRegisterInput } from "./crm-api.ts";
import { PUBLIC_HOST } from "./host.ts";
import { orderFormSettingsSchema, siteSettingsSchema } from "./model.ts";
import { landingAndAttribution, whatsappFallback } from "./public-request.ts";
import { components } from "./publish.ts";
import { isUuid } from "./stats.ts";

export type OrderRaw = {
  pageId: string;
  formId: string;
  fullName: string;
  email: string;
  phone: string;
  companyName?: string;
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

export type OrderResult =
  | { kind: "redirect"; url: string }
  | { kind: "full" }
  | { kind: "closed" }
  | { kind: "already_enrolled" }
  | { kind: "hrdc_contact" }
  | { kind: "invalid"; fields: Record<string, string> }
  | { kind: "limited" }
  | { kind: "captcha" }
  | { kind: "not_found" }
  | { kind: "error"; whatsapp: string | null };

// Asks lead_crm for a Stripe Checkout URL. The class comes from the PUBLISHED
// checkout page's order element and the return URL is the site's own thank-you
// step; nothing of either comes from the request.
export async function submitOrder(
  raw: OrderRaw,
  ctx: { clientIp: string | null; crm?: typeof crmRegister },
): Promise<OrderResult> {
  if (!isUuid(raw.pageId)) return { kind: "not_found" };
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(raw.idempotencyKey)) return { kind: "invalid", fields: { idempotencyKey: "invalid" } };
  const [page] = await db()`
    SELECT p.path, p.site_id, s.settings, v.html
    FROM sales.site_page p JOIN sales.site s ON s.id = p.site_id
    JOIN sales.page_version v ON v.id = p.active_version_id AND v.status = 'published'
    WHERE p.id = ${raw.pageId} AND s.domain = ${PUBLIC_HOST} AND p.kind = 'checkout'`;
  if (!page) return { kind: "not_found" };
  const order = components(page.html ?? "", "order").find((c) => c.id === raw.formId);
  const parsed = orderFormSettingsSchema.safeParse(order?.settings);
  if (!order || !parsed.success) return { kind: "not_found" };
  const o = parsed.data;
  const [thanks] = await db()`
    SELECT path FROM sales.site_page WHERE site_id = ${page.site_id} AND kind = 'thank_you' AND active_version_id IS NOT NULL
    ORDER BY position LIMIT 1`;
  if (!thanks) return { kind: "not_found" };
  const site = siteSettingsSchema.safeParse(page.settings);

  const { landing, q, attribution } = landingAndAttribution(page.path, raw);
  const input: CrmRegisterInput = {
    idempotencyKey: raw.idempotencyKey,
    formName: `order:${o.classCode}`,
    fullName: raw.fullName,
    email: raw.email,
    phone: raw.phone,
    companyName: o.askCompany ? raw.companyName : undefined,
    classCode: o.classCode,
    consentMarketing: raw.consentMarketing,
    captchaToken: raw.captchaToken,
    returnUrl: `https://${PUBLIC_HOST}${thanks.path}`,
    attribution,
  };
  const r = await (ctx.crm ?? crmRegister)(input, { clientIp: ctx.clientIp });
  if (r.kind === "error") return { kind: "error", whatsapp: whatsappFallback(page.settings) };
  if (r.kind !== "checkout") return r;

  if (site.success && site.data.capi) {
    const fbclid = q.get("fbclid");
    const now = new Date();
    try {
      await queueCapi("InitiateCheckout", {
        eventId: `checkout:${raw.idempotencyKey}`,
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
      console.error("site-checkout: capi queue failed"); // the checkout URL exists; never fail the visitor over it
    }
  }
  return { kind: "redirect", url: r.url };
}
