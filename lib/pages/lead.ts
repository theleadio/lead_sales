import { normalizeEmail } from "../crm/email.ts";
import { leadSchema } from "../crm/lead-schema.ts";
import { captureLead, cleanUrl, findReplay } from "../crm/leads.ts";
import { normalizePhoneE164 } from "../crm/phone.ts";
import {
  CONTACT_LIMIT_PER_HOUR,
  helpCaptcha,
  ipLimited,
  type CaptchaVerifier,
  type Env,
} from "../help/intake.ts";
import { db } from "../sql.ts";
import { pageBySlug } from "./admin.ts";

// A landing page's lead form. The submission becomes a CRM lead through
// captureLead (person, touchpoint, consent, deal, LeadCaptured), the same
// path as the CRM's own /enquiry form.
//
// The form's settings (form name, course, class) are read from the published
// page on the server, never from the request. Guarded like the help form:
// 10 a minute per IP, 3 an hour per email or phone, a CAPTCHA once one is
// configured, and a repeated key answers without a second lead.

export type PageLeadResult =
  | { kind: "created" }
  | { kind: "invalid"; fields: Record<string, string> }
  | { kind: "rate_limited" }
  | { kind: "captcha_failed" }
  | { kind: "not_found" };

// utm_* and click ids from the page address the visitor arrived on.
function attributionFrom(landingUrl: string | null) {
  if (!landingUrl) return null;
  const q = new URL(landingUrl).searchParams;
  return {
    utmSource: q.get("utm_source"),
    utmMedium: q.get("utm_medium"),
    utmCampaign: q.get("utm_campaign"),
    utmContent: q.get("utm_content"),
    utmTerm: q.get("utm_term"),
    gclid: q.get("gclid"),
    fbclid: q.get("fbclid"),
    gbraid: q.get("gbraid"),
    wbraid: q.get("wbraid"),
    liFatId: q.get("li_fat_id"),
    ttclid: q.get("ttclid"),
  };
}

// Web-form submissions from this email or phone in the last hour.
async function contactLimited(
  emailNorm: string | null,
  phoneE164: string | null,
): Promise<boolean> {
  if (!emailNorm && !phoneE164) return false;
  const [r] = await db()`
    SELECT count(*)::int AS n
    FROM touchpoint t JOIN person p ON p.id = t.person_id
    WHERE t.channel = 'web_form' AND t.form_name IS NOT NULL
      AND t.occurred_at > now() - interval '1 hour'
      AND (${emailNorm}::text IS NOT NULL AND p.email_norm = ${emailNorm}
           OR ${phoneE164}::text IS NOT NULL AND p.phone_e164 = ${phoneE164})`;
  return r.n >= CONTACT_LIMIT_PER_HOUR;
}

export async function submitPageLead(
  raw: {
    slug: string;
    position: number;
    fullName?: unknown;
    email?: unknown;
    phone?: unknown;
    consentMarketing?: boolean;
    idempotencyKey?: unknown;
    captchaToken?: unknown;
  },
  ctx: {
    ip: string | null;
    env: Env;
    // The page address the form was posted from (the Referer header).
    landingUrl: string | null;
    captcha?: CaptchaVerifier | null;
  },
): Promise<PageLeadResult> {
  const page = await pageBySlug(raw.slug);
  const block = page?.blocks[raw.position];
  if (!page || block?.kind !== "form") return { kind: "not_found" };

  const landingUrl = cleanUrl(ctx.landingUrl);
  const parsed = leadSchema.safeParse({
    idempotencyKey: raw.idempotencyKey,
    formName: block.formName || `page:${page.slug}`,
    fullName: raw.fullName,
    email: raw.email,
    phone: raw.phone,
    preferredLanguage: page.language,
    courseInterest: block.courseInterest,
    classCode: block.classCode,
    consentMarketing: raw.consentMarketing === true,
    attribution: attributionFrom(landingUrl),
    captchaToken: raw.captchaToken,
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0] ?? "");
      if (k && !fields[k]) fields[k] = i.message;
    }
    return { kind: "invalid", fields };
  }
  const input = parsed.data;

  const captcha =
    ctx.captcha === undefined ? helpCaptcha(ctx.env) : ctx.captcha;
  if (captcha && !(await captcha(input.captchaToken, ctx.ip)))
    return { kind: "captcha_failed" };
  // A repeat of an accepted submission spends no limit and makes no lead.
  if (input.idempotencyKey && (await findReplay(input.idempotencyKey)))
    return { kind: "created" };
  if (await ipLimited(ctx.env, ctx.ip, "page-ip"))
    return { kind: "rate_limited" };
  if (
    await contactLimited(
      input.email ? normalizeEmail(input.email) : null,
      input.phone ? normalizePhoneE164(input.phone) : null,
    )
  )
    return { kind: "rate_limited" };

  await captureLead(input, { landingUrl, referrer: null });
  return { kind: "created" };
}
