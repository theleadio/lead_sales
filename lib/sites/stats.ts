import { createHash, createHmac } from "node:crypto";
import type { Role } from "../auth/roles.ts";
import { db, withTransaction } from "../sql.ts";
import { guard } from "./admin.ts";
import { isPublicHost, PUBLIC_HOST } from "./host.ts";
import { formNameFor, leadFormSettingsSchema, normalizePath } from "./model.ts";
import { components } from "./publish.ts";

type Viewer = { id: string; role: Role };

const KL = "+08:00"; // Malaysia has no daylight saving.
export const klDay = (d: Date): string => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

const warned = new Set<string>();
const warnOnce = (msg: string) => {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.error(msg);
};
export const resetViewWarnings = () => warned.clear();

// Netlify's own header first (a client cannot set it), then the first
// x-forwarded-for entry.
export const clientIp = (h: Headers): string | null =>
  h.get("x-nf-client-connection-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

export const viewsEnabled = () => (process.env.PAGE_VIEW_SALT ?? "").length >= 16;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
const VIEW_LIMIT_PER_MIN = 60;

export type ViewPage = { path: string; domain: string; settings: unknown };
export type ViewDecision =
  | { kind: "ok"; page: ViewPage }
  | { kind: "notfound" | "bad" | "forbidden" } // 404, 400, 403
  | { kind: "off" | "limited" }; // 204, nothing recorded

// Whether a view request is to be counted. Order: public host, no salt (off),
// body shape, Origin/Referer on the public host, per-IP limit (60/min, HMAC
// bucket keyed by RATE_LIMIT_SECRET so no IP is stored), then the page must be
// published on the public domain and `variant` one of its published variants.
export async function checkView(r: {
  host: string;
  origin: string | null;
  referer: string | null;
  ip: string | null;
  pageId: unknown;
  variant: unknown;
}): Promise<ViewDecision> {
  if (!isPublicHost(r.host)) return { kind: "notfound" };
  if (!viewsEnabled()) {
    warnOnce("site-view: PAGE_VIEW_SALT not configured");
    return { kind: "off" };
  }
  if (!isUuid(r.pageId) || typeof r.variant !== "string" || !/^[A-Za-z0-9_-]{1,20}$/.test(r.variant)) return { kind: "bad" };
  let from: URL | null = null;
  try {
    from = new URL(r.origin || r.referer || "");
  } catch {}
  if (!from || !isPublicHost(from.host) || (from.protocol !== "https:" && from.hostname !== "site.localhost")) return { kind: "forbidden" };
  const secret = (process.env.RATE_LIMIT_SECRET ?? "").trim();
  if (secret.length < 16) {
    warnOnce("site-view: RATE_LIMIT_SECRET not configured");
    return { kind: "limited" }; // fails closed: count nothing
  }
  const bucket = `site-view:${r.ip ? createHmac("sha256", secret).update(r.ip).digest("hex") : "unknown"}`;
  const [lim] = await db()`SELECT rate_limit_take(${bucket}, 60) AS hits`;
  if (lim.hits > VIEW_LIMIT_PER_MIN) return { kind: "limited" };
  const [page] = await db()`
    SELECT p.path, s.domain, s.settings,
           EXISTS (SELECT 1 FROM sales.page_version v WHERE v.page_id = p.id AND v.variant = ${r.variant} AND v.status = 'published') AS has_variant
    FROM sales.site_page p JOIN sales.site s ON s.id = p.site_id
    JOIN sales.page_version a ON a.id = p.active_version_id AND a.status = 'published'
    WHERE p.id = ${r.pageId} AND s.domain = ${PUBLIC_HOST}`;
  if (!page) return { kind: "notfound" };
  if (!page.has_variant) return { kind: "bad" };
  return { kind: "ok", page: { path: page.path, domain: page.domain, settings: page.settings } };
}

// First sighting of a visitor on a page that KL day bumps `uniques`. The hash
// is salted per deployment and per day, so it can't follow a visitor across
// days. No salt (or a short one) = nothing recorded.
export async function recordView(pageId: string, variant: string, visitorId: string, now: Date): Promise<void> {
  const salt = process.env.PAGE_VIEW_SALT ?? "";
  if (salt.length < 16) return;
  const day = klDay(now);
  const hash = createHash("sha256").update(salt + visitorId + day).digest("hex");
  await withTransaction(async () => {
    const sql = db();
    const fresh = await sql`
      INSERT INTO sales.page_view_seen (page_id, day, visitor_hash) VALUES (${pageId}, ${day}, ${hash})
      ON CONFLICT DO NOTHING RETURNING 1`;
    await sql`
      INSERT INTO sales.page_view_day (page_id, variant, day, views, uniques) VALUES (${pageId}, ${variant}, ${day}, 1, ${fresh.length})
      ON CONFLICT (page_id, variant, day)
      DO UPDATE SET views = page_view_day.views + 1, uniques = page_view_day.uniques + ${fresh.length}`;
  });
}

// Path of `url` when it is on `domain`, else null.
export function pathOn(url: string | null, domain: string): string | null {
  try {
    const u = new URL(url ?? "");
    return u.hostname.toLowerCase() === domain.toLowerCase() ? normalizePath(u.pathname) : null;
  } catch {
    return null;
  }
}

export type AttributedPayment = {
  id: string;
  net: number;
  paidAt: Date;
  landingUrl: string;
  fbclid: string | null;
  touchAt: Date;
  email: string | null;
  phone: string | null;
  consent: boolean;
};

// Payments (succeeded or partly refunded, net of refunds) paid in [a, b) that
// trace back to a touchpoint. Join: payment -> its enrolment's deal (or the
// payment's own deal) -> deal.source_touchpoint_id; if that is null, the
// person's latest web_form touchpoint in the 2 minutes up to the deal's
// created_at (the CRM register call writes both together).
export async function attributedPayments(a: Date, b: Date): Promise<AttributedPayment[]> {
  const rows = await db()`
    SELECT p.id, (p.amount_myr - p.refunded_amount_myr)::float8 AS net, p.paid_at,
           t.landing_url, t.fbclid, t.occurred_at AS touch_at, pr.email, pr.phone_e164 AS phone,
           EXISTS (SELECT 1 FROM consent_current c WHERE c.person_id = d.person_id AND c.is_granted
                   AND c.purpose IN ('marketing_email','marketing_whatsapp')) AS consent
    FROM payment p
    LEFT JOIN enrolment e ON e.id = p.enrolment_id
    JOIN deal d ON d.id = COALESCE(e.deal_id, p.deal_id)
    JOIN touchpoint t ON t.id = COALESCE(d.source_touchpoint_id, (
      SELECT t2.id FROM touchpoint t2
      WHERE t2.person_id = d.person_id AND t2.channel = 'web_form'
        AND t2.occurred_at BETWEEN d.created_at - interval '2 minutes' AND d.created_at
      ORDER BY t2.occurred_at DESC LIMIT 1))
    JOIN person pr ON pr.id = d.person_id
    WHERE p.status IN ('succeeded','partially_refunded') AND p.paid_at >= ${a} AND p.paid_at < ${b}
      AND t.landing_url IS NOT NULL`;
  return rows.map((r) => ({
    id: r.id, net: r.net, paidAt: r.paid_at, landingUrl: r.landing_url, fbclid: r.fbclid,
    touchAt: r.touch_at, email: r.email, phone: r.phone, consent: r.consent,
  }));
}

export type StepStats = {
  pageId: string;
  name: string;
  views: number;
  uniques: number;
  optins: number;
  optinRate: number;
  orders: number;
  revenueMyr: number;
  avgOrderMyr: number;
  earningsPerView: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

// `from`/`to` are KL days (YYYY-MM-DD), inclusive. `uniques` over a range is
// the sum of daily uniques (a visitor on two days counts twice); optinRate is
// optins / uniques.
export async function siteStats(viewer: Viewer, siteId: string, from: string, to: string): Promise<StepStats[]> {
  await guard(viewer, "view site stats", false);
  const sql = db();
  const [site] = await sql`SELECT domain FROM sales.site WHERE id = ${siteId}`;
  if (!site) return [];
  const pages = await sql`
    SELECT p.id, p.name, p.path, v.html
    FROM sales.site_page p
    LEFT JOIN sales.page_version v ON v.id = p.active_version_id AND v.status = 'published'
    WHERE p.site_id = ${siteId} ORDER BY p.position`;
  const views = new Map(
    (
      await sql`
        SELECT d.page_id, sum(d.views)::int AS views, sum(d.uniques)::int AS uniques
        FROM sales.page_view_day d JOIN sales.site_page p ON p.id = d.page_id
        WHERE p.site_id = ${siteId} AND d.day BETWEEN ${from}::date AND ${to}::date GROUP BY d.page_id`
    ).map((r) => [r.page_id, r]),
  );

  // The form names the site's published pages carry (page slug = path without
  // the leading slash, "home" for "/").
  const names = new Set<string>();
  for (const p of pages) {
    for (const c of components(p.html ?? "", "form")) {
      const s = leadFormSettingsSchema.safeParse(c.settings);
      if (s.success) names.add(formNameFor(s.data, p.path === "/" ? "home" : p.path.slice(1)));
    }
  }
  const a = new Date(`${from}T00:00:00${KL}`);
  const b = new Date(new Date(`${to}T00:00:00${KL}`).getTime() + 86_400_000);
  const optins = new Map<string, number>();
  if (names.size) {
    const tps = await sql`
      SELECT landing_url FROM touchpoint
      WHERE channel = 'web_form' AND form_name = ANY(${[...names]}) AND occurred_at >= ${a} AND occurred_at < ${b}`;
    for (const t of tps) {
      const path = pathOn(t.landing_url, site.domain);
      if (path) optins.set(path, (optins.get(path) ?? 0) + 1);
    }
  }
  const orders = new Map<string, { n: number; sum: number }>();
  for (const p of await attributedPayments(a, b)) {
    const path = pathOn(p.landingUrl, site.domain);
    if (!path) continue;
    const o = orders.get(path) ?? { n: 0, sum: 0 };
    orders.set(path, { n: o.n + 1, sum: o.sum + p.net });
  }

  return pages.map((p) => {
    const v = views.get(p.id);
    const o = orders.get(p.path) ?? { n: 0, sum: 0 };
    const nViews = v?.views ?? 0;
    const nUniques = v?.uniques ?? 0;
    const nOptins = optins.get(p.path) ?? 0;
    return {
      pageId: p.id,
      name: p.name,
      views: nViews,
      uniques: nUniques,
      optins: nOptins,
      optinRate: nUniques ? nOptins / nUniques : 0,
      orders: o.n,
      revenueMyr: r2(o.sum),
      avgOrderMyr: o.n ? r2(o.sum / o.n) : 0,
      earningsPerView: nViews ? r2(o.sum / nViews) : 0,
    };
  });
}
