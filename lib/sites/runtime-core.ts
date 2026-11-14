// Pure logic of public/site/runtime.js (no DOM). scripts/build-runtime.ts strips
// the types and inlines this file, so keep imports single-line and relative.
// Attribution rules mirror lib/crm/attribution.ts.
import { COPY } from "./runtime-copy.ts";

export type Lang = "en" | "zh";
export const langOf = (l: string | null | undefined): Lang => (/^zh/i.test(l ?? "") ? "zh" : "en");
export const t = (lang: Lang, k: string): string => COPY[lang][k] ?? COPY.en[k] ?? k;

// ---- attribution cookies ----
export const FIRST = "lead_first_touch";
export const LAST = "lead_last_touch";
const KEYS: [string, string, number][] = [
  ["utmSource", "utm_source", 200], ["utmMedium", "utm_medium", 200], ["utmCampaign", "utm_campaign", 200],
  ["utmContent", "utm_content", 200], ["utmTerm", "utm_term", 200], ["gclid", "gclid", 200],
  ["fbclid", "fbclid", 500], ["gbraid", "gbraid", 200], ["wbraid", "wbraid", 200],
  ["liFatId", "li_fat_id", 200], ["ttclid", "ttclid", 200],
];
const KEEP = /^(utm_[a-z]+|gclid|fbclid|gbraid|wbraid|li_fat_id|ttclid)$/;

export function trimUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.username = "";
    u.password = "";
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (!KEEP.test(k)) u.searchParams.delete(k);
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export function touchFrom(href: string, referrer: string | null, now: Date): Record<string, string | null> {
  let q = new URLSearchParams();
  try {
    q = new URL(href).searchParams;
  } catch {}
  const o: Record<string, string | null> = {};
  for (const [name, param, max] of KEYS) o[name] = (q.get(param) ?? "").trim().slice(0, max) || null;
  o.landingUrl = trimUrl(href);
  o.referrer = trimUrl(referrer);
  o.occurredAt = now.toISOString();
  return o;
}

export const hasCampaign = (o: Record<string, string | null>): boolean => KEYS.some(([n]) => !!o[n]);

// Same tolerance as the CRM's parseTouch: JSON first, percent-decoded JSON second.
export function readable(raw: string | null | undefined): boolean {
  if (!raw) return false;
  for (const f of [(s: string) => s, decodeURIComponent]) {
    try {
      const o = JSON.parse(f(raw));
      if (o && typeof o === "object" && typeof o.occurredAt === "string") return true;
    } catch {}
  }
  return false;
}

export function touchCookie(name: string, value: string, secure: boolean): string {
  return [`${name}=${value}`, "Path=/", `Max-Age=${90 * 86400}`, "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}

// Cookie lines to write for this arrival. Nothing unless the URL carries a UTM
// param or click id; the first touch is never replaced; the last always is.
export function cookiesToWrite(
  existingFirst: string | null | undefined,
  href: string,
  referrer: string | null,
  now: Date,
): string[] {
  const arrival = touchFrom(href, referrer, now);
  if (!hasCampaign(arrival)) return [];
  const v = encodeURIComponent(JSON.stringify(arrival));
  const secure = /^https:/i.test(href);
  const out = [touchCookie(LAST, v, secure)];
  if (!readable(existingFirst)) out.unshift(touchCookie(FIRST, v, secure));
  return out;
}

export function cookieValue(all: string, name: string): string | null {
  for (const p of all.split(";")) {
    const i = p.indexOf("=");
    if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim();
  }
  return null;
}

// ---- settings (untrusted JSON from data-settings) ----
export type FormSettings = { fields: string[]; askCompany: boolean; classCode: string };
const OPTIONAL = ["company", "jobTitle", "message"];

export function parseSettings(raw: string | null | undefined, kind: "form" | "order"): FormSettings | null {
  let o: any;
  try {
    o = JSON.parse(raw ?? "");
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  if (kind === "order") {
    if (typeof o.classCode !== "string" || !o.classCode || typeof o.askCompany !== "boolean") return null;
    return { fields: o.askCompany ? ["company"] : [], askCompany: o.askCompany, classCode: o.classCode };
  }
  if (!Array.isArray(o.fields)) return null;
  return { fields: o.fields.filter((f: unknown) => OPTIONAL.includes(f as string)), askCompany: false, classCode: "" };
}

// ---- request / response ----
export type Values = Record<string, string>;
export function buildPayload(
  s: FormSettings,
  ids: { pageId: string; formId: string; idempotencyKey: string; landingUrl: string; referrer: string },
  v: Values,
  consent: boolean,
  captchaToken?: string,
): Record<string, unknown> {
  const p: Record<string, unknown> = {
    ...ids,
    fullName: v.fullName ?? "",
    email: v.email ?? "",
    phone: v.phone ?? "",
    consentMarketing: consent,
  };
  if (s.fields.includes("company")) p.companyName = v.companyName ?? "";
  if (s.fields.includes("jobTitle")) p.jobTitle = v.jobTitle ?? "";
  if (s.fields.includes("message")) p.message = v.message ?? "";
  if (captchaToken) p.captchaToken = captchaToken;
  return p;
}

export type Outcome =
  | { kind: "text"; text: string; ok: boolean; fields?: Record<string, string>; whatsapp?: string }
  | { kind: "go"; url: string };

const STRIPE = "https://checkout.stripe.com/";
const RESULTS = ["full", "closed", "already_enrolled", "hrdc_contact"];
const WA = /^https:\/\/wa\.me\/\d+$/;
const obj = (b: unknown): any => (b && typeof b === "object" ? b : {});

// 200 from /api/site/form. A step target arrives as a same-origin path.
export function formSuccess(lang: Lang, body: unknown): Outcome {
  const a = obj(obj(body).after);
  if (a.kind === "url" && typeof a.url === "string" && a.url.startsWith("https://")) return { kind: "go", url: a.url };
  if (a.kind === "step" && typeof a.path === "string" && /^\/(?!\/)[^\\\s\x00-\x1f]*$/.test(a.path)) return { kind: "go", url: a.path };
  if (a.kind === "message" && typeof a.text === "string" && a.text) return { kind: "text", ok: true, text: a.text };
  return { kind: "text", ok: true, text: t(lang, "success") };
}

// 200 from /api/site/checkout: only a Stripe Checkout URL is followed.
export function checkoutSuccess(lang: Lang, body: unknown): Outcome {
  const b = obj(body);
  if (typeof b.redirect === "string" && b.redirect.startsWith(STRIPE)) return { kind: "go", url: b.redirect };
  if (RESULTS.includes(b.result)) {
    return { kind: "text", ok: b.result === "already_enrolled" || b.result === "hrdc_contact", text: t(lang, b.result) };
  }
  return failure(lang, 502, {});
}

export function failure(lang: Lang, status: number, body: unknown): Outcome {
  const b = obj(body);
  if (status === 429) return { kind: "text", ok: false, text: t(lang, "limited") };
  if (status === 400 && b.error === "captcha") return { kind: "text", ok: false, text: t(lang, "captcha") };
  if (status === 400 && b.error === "invalid") {
    const fields: Record<string, string> = {};
    for (const k of Object.keys(obj(b.fields))) fields[k] = t(lang, "invalid");
    return { kind: "text", ok: false, text: t(lang, "checkFields"), fields };
  }
  const wa = typeof b.whatsapp === "string" && WA.test(b.whatsapp) ? b.whatsapp : undefined;
  return { kind: "text", ok: false, text: t(lang, "unavailable"), whatsapp: wa };
}

// ---- popups, animation, button actions ----
export type PopupState = { touch: boolean; elapsedSec: number; exitIntent: boolean; seen: boolean; delaySec: number };
// Button-triggered popups open only through their button. Exit intent never fires on touch.
export function popupShouldOpen(trigger: string, s: PopupState): boolean {
  if (s.seen) return false;
  if (trigger === "timer") return s.elapsedSec >= s.delaySec;
  if (trigger === "exit") return !s.touch && s.exitIntent;
  return false;
}

export type Target = { kind: "scroll" | "nav" | "popup" | "none"; value?: string };
// "form"/"next"/"url" hrefs are already correct in the markup; only popup needs JS.
export function buttonTarget(action: string | null | undefined, ctx: { popupIds: string[] }): Target {
  const a = action ?? "";
  if (a === "form") return { kind: "scroll", value: '[data-lead="form"],[data-lead="order"]' };
  if (a === "next" || a === "url") return { kind: "nav" };
  if (a.startsWith("popup:")) {
    const id = a.slice(6);
    return ctx.popupIds.includes(id) ? { kind: "popup", value: id } : { kind: "none" };
  }
  return { kind: "none" };
}

export const animEnabled = (hasObserver: boolean, reducedMotion: boolean): boolean => hasObserver && !reducedMotion;

export function countdownParts(to: string, nowMs: number): { done: boolean; d: number; h: number; m: number; s: number } {
  const ms = Date.parse(to) - nowMs;
  if (!isFinite(ms) || ms <= 0) return { done: true, d: 0, h: 0, m: 0, s: 0 };
  const x = Math.floor(ms / 1000);
  return { done: false, d: Math.floor(x / 86400), h: Math.floor((x % 86400) / 3600), m: Math.floor((x % 3600) / 60), s: x % 60 };
}
