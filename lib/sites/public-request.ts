import { attributionPayload, parseTouch, touchFrom, trimUrl } from "../crm/attribution.ts";
import { PUBLIC_HOST } from "./host.ts";
import { siteSettingsSchema } from "./model.ts";
import type { CrmLeadInput } from "./crm-api.ts";

// Shared by the public LEAD-form and order-form endpoints.

// Reads a request body as text, refusing more than `max` bytes (null = too big).
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const t = await req.text();
  return new TextEncoder().encode(t).length > max ? null : t;
}

// Host and path are ours (the page being submitted); only the query comes from the visitor.
export function landingAndAttribution(
  pagePath: string,
  raw: { landingUrl: string; referrer: string | null; firstTouch?: string; lastTouch?: string },
) {
  const first = parseTouch(raw.firstTouch);
  const landing = new URL(`https://${PUBLIC_HOST}${pagePath}`);
  try {
    landing.search = new URL(raw.landingUrl).search;
  } catch {}
  const q = landing.searchParams;
  const last = parseTouch(raw.lastTouch) ?? touchFrom(landing.href, raw.referrer);
  const attribution = {
    ...attributionPayload(first, last),
    landingUrl: trimUrl(landing.href), // the page the form is on, which the stats match on
    utmId: q.get("utm_id")?.slice(0, 200) || null,
    utmAdId: q.get("utm_ad_id")?.slice(0, 200) || null,
  } as NonNullable<CrmLeadInput["attribution"]>;
  return { landing, q, attribution };
}

// The site's WhatsApp fallback link for when the CRM is unreachable.
export function whatsappFallback(settings: unknown): string | null {
  const site = siteSettingsSchema.safeParse(settings);
  const wa = site.success ? site.data.chatWidget?.whatsapp.replace(/\D/g, "") : "";
  return wa ? `https://wa.me/${wa}` : null;
}
