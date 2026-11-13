// Server-to-server client for lead_crm's public API (PR #80: /api/public/leads
// and /api/public/register). Field names mirror lead_crm lib/validation/public.ts
// (leadSchema / registerSchema); keep in step. Never logs bodies or personal
// data, only the failure kind and status.

export type CrmAttribution = {
  utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null;
  utmContent?: string | null; utmTerm?: string | null; utmId?: string | null; utmAdId?: string | null;
  gclid?: string | null; fbclid?: string | null; gbraid?: string | null; wbraid?: string | null;
  liFatId?: string | null; ttclid?: string | null;
  landingUrl?: string | null; referrer?: string | null;
  firstTouch?: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; occurredAt?: string | null } | null;
};

export type CrmLeadInput = {
  idempotencyKey?: string | null;
  formName?: string | null;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  message?: string | null;
  preferredLanguage?: "en" | "zh" | null;
  courseInterest?: string | null;
  classCode?: string | null;
  consentMarketing?: boolean | null;
  hrdcIntended?: boolean | null;
  captchaToken?: string | null;
  createDeal?: boolean | null;
  attribution?: CrmAttribution | null;
};

export type CrmRegisterInput = Omit<CrmLeadInput, "classCode"> & {
  classCode: string;
  locale?: "en" | "zh" | null;
  returnUrl?: string | null;
};

type Ctx = { clientIp: string | null };
type Common =
  | { kind: "invalid"; fields: Record<string, string> }
  | { kind: "limited" }
  | { kind: "captcha" }
  | { kind: "error" };

export type CrmLeadResult = { kind: "ok"; personId: string; dealId: string | null } | Common;
export type CrmRegisterResult =
  | { kind: "checkout"; url: string }
  | { kind: "full" }
  | { kind: "closed" }
  | { kind: "already_enrolled" }
  | { kind: "hrdc_contact" }
  | Common;

// ---- fetch (injectable for tests) ----

let crmFetch: typeof fetch = (...a) => fetch(...a);
export function setCrmFetch(f: typeof fetch) {
  crmFetch = f;
}

type Raw = { status: number; body: any } | null;

async function post(path: string, input: unknown, ctx: Ctx): Promise<Raw> {
  const base = process.env.CRM_BASE_URL;
  const key = process.env.PUBLIC_API_KEY;
  if (!base || !key) {
    console.error("crm api not configured");
    return null;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Api-Key": key };
  if (ctx.clientIp) headers["X-Lead-Client-Ip"] = ctx.clientIp;
  try {
    const r = await crmFetch(`${base.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } catch (e) {
    console.error(`crm api ${path} failed: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

// Failures common to both routes. CRM codes: handlers.ts publicPost/intakeFlow
// (400 validation_failed + fields, 429 rate_limited, 403 captcha_failed).
function failure(path: string, r: Raw): Common {
  if (!r) return { kind: "error" };
  const code = r.body?.error?.code;
  if (r.status === 400 && code === "validation_failed") {
    const f = r.body.error.fields;
    return { kind: "invalid", fields: f && typeof f === "object" ? f : {} };
  }
  if (r.status === 429) return { kind: "limited" };
  if (r.status === 403 && code === "captcha_failed") return { kind: "captcha" };
  console.error(`crm api ${path} failed: HTTP ${r.status} ${typeof code === "string" ? code : ""}`.trim());
  return { kind: "error" };
}

export async function crmLead(input: CrmLeadInput, ctx: Ctx): Promise<CrmLeadResult> {
  const path = "/api/public/leads";
  const r = await post(path, input, ctx);
  if (r?.status === 201 && typeof r.body?.personId === "string")
    return { kind: "ok", personId: r.body.personId, dealId: typeof r.body.dealId === "string" ? r.body.dealId : null };
  return failure(path, r);
}

export async function crmRegister(input: CrmRegisterInput, ctx: Ctx): Promise<CrmRegisterResult> {
  const path = "/api/public/register";
  const r = await post(path, input, ctx);
  if (r?.status === 201 && r.body?.next === "checkout" && typeof r.body.checkoutUrl === "string") {
    // The visitor is redirected here, so only a Stripe Checkout URL is believed.
    try {
      const u = new URL(r.body.checkoutUrl);
      if (u.protocol === "https:" && u.hostname === "checkout.stripe.com") return { kind: "checkout", url: u.href };
    } catch {}
    console.error("crm: unexpected checkout url");
    return { kind: "error" };
  }
  // HRDC claimed: the CRM contacts the company, no checkout URL.
  if (r?.status === 201 && r.body?.next === "hrdc_contact") return { kind: "hrdc_contact" };
  // 409 from register(): handlers.ts handleRegister finish() switch.
  if (r?.status === 409) {
    const code = r.body?.error?.code;
    if (code === "no_seats") return { kind: "full" };
    if (code === "class_unavailable") return { kind: "closed" };
    if (code === "already_enrolled") return { kind: "already_enrolled" };
  }
  return failure(path, r);
}

export type CrmScheduleClass = {
  code: string;
  courseName: string;
  startDate: string;
  endDate: string;
  priceMyr: string | null;
  seatsLabel: "available" | "few_seats" | "full";
};

// GET /api/public/schedule: the public classes (open, few seats, full; limit max 100).
export async function crmSchedule(): Promise<{ kind: "ok"; classes: CrmScheduleClass[] } | { kind: "error" }> {
  const base = process.env.CRM_BASE_URL;
  const key = process.env.PUBLIC_API_KEY;
  if (!base || !key) {
    console.error("crm api not configured");
    return { kind: "error" };
  }
  try {
    const r = await crmFetch(`${base.replace(/\/+$/, "")}/api/public/schedule?limit=100`, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await r.json().catch(() => null);
    if (r.status === 200 && Array.isArray(body?.classes)) return { kind: "ok", classes: body.classes };
    console.error(`crm api /api/public/schedule failed: HTTP ${r.status}`);
  } catch (e) {
    console.error(`crm api /api/public/schedule failed: ${e instanceof Error ? e.name : "error"}`);
  }
  return { kind: "error" };
}

// 60 s in-process cache of a successful feed; errors are never cached and
// concurrent misses share one CRM call. ponytail: per-instance, fine for a 60 s feed.
let feed: { at: number; value: Promise<Awaited<ReturnType<typeof crmSchedule>>> } | null = null;
export function crmScheduleCached(now = Date.now()) {
  if (!feed || now - feed.at >= 60_000) {
    const mine = { at: now, value: crmSchedule() };
    feed = mine;
    mine.value.then((r) => {
      if (r.kind !== "ok" && feed === mine) feed = null;
    });
  }
  return feed.value;
}
export const resetCrmScheduleCache = () => {
  feed = null;
};
