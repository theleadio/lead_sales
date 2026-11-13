import { createHash } from "node:crypto";
import type { Role } from "../auth/roles.ts";
import { db, withTransaction } from "../sql.ts";
import { guard } from "./admin.ts";
import { formNameFor, leadFormSettingsSchema, normalizePath } from "./model.ts";
import { components } from "./publish.ts";

type Viewer = { id: string; role: Role };

const KL = "+08:00"; // Malaysia has no daylight saving.
export const klDay = (d: Date): string => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

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
