import { createHash } from "node:crypto";
import { db } from "../sql.ts";
import { attributedPayments, klDay, pathOn } from "./stats.ts";

// Server-side Meta Conversions API. queueCapi writes a ready-to-send event
// (hashed identifiers only, never raw email/phone); drainCapi sends the due
// ones. Nothing here logs a token or a payload: counts and statuses only.

export type CapiName = "PageView" | "Lead" | "InitiateCheckout" | "Purchase";
export type CapiEvent = {
  eventId: string;
  eventTime: Date;
  sourceUrl: string;
  fbc?: string;
  fbp?: string;
  email?: string;
  phone?: string;
  consent: boolean;
  valueMyr?: number;
  clientIp?: string;
  userAgent?: string;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const fbcFrom = (fbclid: string, ms: number) => `fb.1.${ms}.${fbclid}`;

// Only a person who consented has their email/phone hashed and sent.
export async function queueCapi(name: CapiName, e: CapiEvent): Promise<void> {
  const email = e.consent && e.email?.trim() ? sha(e.email.trim().toLowerCase()) : undefined;
  const digits = e.phone?.replace(/\D/g, "");
  const phone = e.consent && digits ? sha(digits) : undefined;
  const event = {
    event_name: name,
    event_time: Math.floor(e.eventTime.getTime() / 1000),
    event_id: e.eventId,
    event_source_url: e.sourceUrl,
    action_source: "website",
    user_data: {
      ...(email && { em: [email] }),
      ...(phone && { ph: [phone] }),
      ...(e.fbc && { fbc: e.fbc }),
      ...(e.fbp && { fbp: e.fbp }),
      ...(e.clientIp && { client_ip_address: e.clientIp }),
      ...(e.userAgent && { client_user_agent: e.userAgent }),
    },
    ...(e.valueMyr !== undefined && { custom_data: { currency: "MYR", value: e.valueMyr } }),
  };
  const sql = db();
  await sql`
    INSERT INTO sales.capi_event (event_id, name, payload) VALUES (${e.eventId}, ${name}, ${sql.json(event)})
    ON CONFLICT (event_id) DO NOTHING`;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

// One Purchase per payment traced to a step of a site with capi on (same join
// as the stats; the event_id makes a rescan harmless).
async function queuePurchases(now: Date) {
  const steps = await db()`
    SELECT s.domain, p.path FROM sales.site s JOIN sales.site_page p ON p.site_id = s.id
    WHERE s.settings @> '{"capi": true}'`;
  if (!steps.length) return;
  const live = new Set(steps.map((s) => `${s.domain}${s.path}`));
  for (const p of await attributedPayments(new Date(now.getTime() - 7 * 86_400_000), new Date(now.getTime() + 1))) {
    const host = hostOf(p.landingUrl);
    const path = pathOn(p.landingUrl, host);
    if (!path || !live.has(`${host}${path}`)) continue;
    await queueCapi("Purchase", {
      eventId: `purchase:${p.id}`,
      eventTime: p.paidAt,
      sourceUrl: p.landingUrl,
      fbc: p.fbclid ? fbcFrom(p.fbclid, p.touchAt.getTime()) : undefined,
      email: p.email ?? undefined,
      phone: p.phone ?? undefined,
      consent: p.consent,
      valueMyr: p.net,
    });
  }
}

const BACKOFF_MIN = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = 5;

// Sends everything due in one batch (max 1000). 2xx = sent; 4xx (not 429) =
// failed for good; anything else retries after BACKOFF_MIN[attempts-1], and
// fails on the 5th attempt. ponytail: one bad event in a 400 batch fails the
// whole batch; split the batch if that ever happens in practice.
export async function drainCapi(now: Date, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const token = process.env.META_CAPI_TOKEN;
  const pixel = process.env.META_PIXEL_ID;
  if (!token || !pixel) return { sent: 0, failed: 0 };
  const sql = db();
  await queuePurchases(now);
  await sql`DELETE FROM sales.page_view_seen WHERE day < ${klDay(new Date(now.getTime() - 2 * 86_400_000))}::date`;
  const due = await sql`
    SELECT id, payload, attempts FROM sales.capi_event
    WHERE status = 'queued' AND next_attempt_at <= ${now} ORDER BY created_at LIMIT 1000`;
  if (!due.length) return { sent: 0, failed: 0 };

  const test = process.env.META_TEST_EVENT_CODE;
  let status = 0;
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: due.map((r) => r.payload), ...(test && { test_event_code: test }) }),
      },
    );
    status = res.status;
  } catch {
    // status stays 0: a network error, retried. The error text is dropped on purpose.
  }
  const ids = due.map((r) => r.id as string);
  if (status >= 200 && status < 300) {
    await sql`UPDATE sales.capi_event SET status = 'sent', attempts = attempts + 1, last_error = NULL WHERE id = ANY(${ids}::uuid[])`;
    return { sent: ids.length, failed: 0 };
  }
  const error = status ? `HTTP ${status}` : "network error";
  const permanent = status >= 400 && status < 500 && status !== 429;
  let failed = 0;
  for (const r of due) {
    const attempts = (r.attempts as number) + 1;
    if (permanent || attempts >= MAX_ATTEMPTS) {
      failed++;
      await sql`UPDATE sales.capi_event SET status = 'failed', attempts = ${attempts}, last_error = ${error} WHERE id = ${r.id}`;
    } else {
      const next = new Date(now.getTime() + BACKOFF_MIN[attempts - 1] * 60_000);
      await sql`UPDATE sales.capi_event SET attempts = ${attempts}, last_error = ${error}, next_attempt_at = ${next} WHERE id = ${r.id}`;
    }
  }
  return { sent: 0, failed };
}
