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
const CLAIM_MIN = 15;
const TOKEN_BACKOFF_MIN = 30;

// Drops what is only needed to send: once an event is sent or failed its IP
// and user agent are not kept.
const strip = (sql: ReturnType<typeof db>) => sql`payload = jsonb_set(payload, '{user_data}', (payload->'user_data') - 'client_ip_address' - 'client_user_agent')`;

type Due = { id: string; payload: unknown; attempts: number };
type Out = { sent: number; stop: boolean; was400: boolean };

const MAX_400_CALLS = 25;

// Sends everything due, up to 1000 events, claimed atomically (FOR UPDATE
// SKIP LOCKED) so overlapping runs never take the same row. The claim marker is
// next_attempt_at pushed 15 minutes ahead (the 006 CHECK has no 'sending'
// status): a run that dies leaves its rows due again after 15 minutes.
//
// Outcomes: 2xx sent. Token rejected (401/403, or OAuthException / code 190)
// stops the run. 400: the batch is halved and resent until the one bad event
// is alone; failures are held back until the run ends, because a config fault
// (wrong pixel id or test code) 400s everything: if both halves of a split
// return 400, or more than 25 calls returned 400, the run stops and fails
// nothing. A stopped run leaves every unsettled claimed row queued, 30 minutes
// on, attempts unchanged. 429, 5xx, network error: retry after
// BACKOFF_MIN[attempts-1] and fail on the 5th attempt.
// ponytail: two genuinely bad events in different halves look like a config
// fault and stop the run too; they get isolated once one of them is sent apart.
export async function drainCapi(now: Date, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const token = process.env.META_CAPI_TOKEN;
  const pixel = process.env.META_PIXEL_ID;
  if (!token || !pixel) return { sent: 0, failed: 0 };
  const sql = db();
  await queuePurchases(now);
  await sql`DELETE FROM sales.page_view_seen WHERE day < ${klDay(new Date(now.getTime() - 2 * 86_400_000))}::date`;
  const claimUntil = new Date(now.getTime() + CLAIM_MIN * 60_000);
  const due = (await sql`
    UPDATE sales.capi_event SET next_attempt_at = ${claimUntil}
    WHERE id IN (
      SELECT id FROM sales.capi_event WHERE status = 'queued' AND next_attempt_at <= ${now}
      ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED)
    RETURNING id, payload, attempts, created_at`) as unknown as (Due & { created_at: Date })[];
  due.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  if (!due.length) return { sent: 0, failed: 0 };

  const test = process.env.META_TEST_EVENT_CODE;
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(token)}`;
  const hold: Due[] = []; // events a single-event 400 isolated; failed when the run ends cleanly
  let calls400 = 0;
  let failedNow = 0; // 5th-attempt failures
  let stopMsg = "";

  const attempt = async (rows: Due[]): Promise<Out> => {
    let status = 0;
    let oauth = false;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: rows.map((r) => r.payload), ...(test && { test_event_code: test }) }),
      });
      status = res.status;
      if (status >= 400) {
        const e = ((await res.json().catch(() => null)) as { error?: { type?: string; code?: number } } | null)?.error;
        oauth = e?.type === "OAuthException" || e?.code === 190;
      }
    } catch {
      // status stays 0: a network error, retried. The error text is dropped on purpose.
    }
    const ids = rows.map((r) => r.id);
    if (status >= 200 && status < 300) {
      await sql`UPDATE sales.capi_event SET status = 'sent', attempts = attempts + 1, last_error = NULL, ${strip(sql)} WHERE id = ANY(${ids}::uuid[])`;
      return { sent: rows.length, stop: false, was400: false };
    }
    if (status === 401 || status === 403 || oauth) {
      stopMsg = "capi: token rejected";
      return { sent: 0, stop: true, was400: false };
    }
    if (status === 400) {
      if (++calls400 > MAX_400_CALLS) {
        stopMsg = "capi: batch rejected — check pixel id / test code";
        return { sent: 0, stop: true, was400: true };
      }
      if (rows.length === 1) {
        hold.push(rows[0]);
        return { sent: 0, stop: false, was400: true };
      }
      const mid = rows.length >> 1;
      const a = await attempt(rows.slice(0, mid));
      if (a.stop) return { ...a, was400: true };
      const b = await attempt(rows.slice(mid));
      if (!b.stop && a.was400 && b.was400) {
        stopMsg = "capi: batch rejected — check pixel id / test code";
        return { sent: a.sent + b.sent, stop: true, was400: true };
      }
      return { sent: a.sent + b.sent, stop: b.stop, was400: true };
    }
    const error = status ? `HTTP ${status}` : "network error";
    for (const r of rows) {
      const attempts = r.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await sql`UPDATE sales.capi_event SET status = 'failed', attempts = ${attempts}, last_error = ${error}, ${strip(sql)} WHERE id = ${r.id}`;
        failedNow++;
      } else {
        const next = new Date(now.getTime() + BACKOFF_MIN[attempts - 1] * 60_000);
        await sql`UPDATE sales.capi_event SET attempts = ${attempts}, last_error = ${error}, next_attempt_at = ${next} WHERE id = ${r.id}`;
      }
    }
    return { sent: 0, stop: false, was400: false };
  };

  const r = await attempt(due);
  if (r.stop) {
    console.error(stopMsg);
    const next = new Date(now.getTime() + TOKEN_BACKOFF_MIN * 60_000);
    await sql`
      UPDATE sales.capi_event SET last_error = ${stopMsg.includes("token") ? "token rejected" : "batch rejected"}, next_attempt_at = ${next}
      WHERE id = ANY(${due.map((d) => d.id)}::uuid[]) AND status = 'queued' AND next_attempt_at = ${claimUntil}`;
    return { sent: r.sent, failed: failedNow };
  }
  for (const h of hold) {
    await sql`UPDATE sales.capi_event SET status = 'failed', attempts = attempts + 1, last_error = 'HTTP 400', ${strip(sql)} WHERE id = ${h.id}`;
  }
  return { sent: r.sent, failed: failedNow + hold.length };
}
