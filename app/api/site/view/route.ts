import type { NextRequest } from "next/server";
import { db } from "@/lib/sql";
import { isPublicHost } from "@/lib/sites/host";
import { siteSettingsSchema } from "@/lib/sites/model";
import { queueCapi } from "@/lib/sites/capi";
import { klDay, recordView } from "@/lib/sites/stats";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A page view from the public runtime: POST {pageId, variant}. Counts it
// (views / uniques) and, when the site has capi on, queues a PageView.
// Public host only; the visitor id is the first-party cookie lead_vid.
export async function POST(req: NextRequest) {
  if (!isPublicHost(req.headers.get("host") ?? "")) return new Response("Not found", { status: 404 });
  let body: { pageId?: unknown; variant?: unknown } = {};
  try {
    body = await req.json();
  } catch {}
  const { pageId, variant } = body;
  if (typeof pageId !== "string" || !UUID.test(pageId) || typeof variant !== "string" || !/^[A-Za-z0-9_-]{1,20}$/.test(variant)) {
    return new Response("Bad request", { status: 400 });
  }
  const [page] = await db()`
    SELECT p.path, s.domain, s.settings
    FROM sales.site_page p JOIN sales.site s ON s.id = p.site_id
    JOIN sales.page_version v ON v.id = p.active_version_id AND v.status = 'published'
    WHERE p.id = ${pageId}`;
  if (!page) return new Response("Not found", { status: 404 });

  const existing = req.cookies.get("lead_vid")?.value;
  const visitorId = existing && UUID.test(existing) ? existing : crypto.randomUUID();
  const now = new Date();
  await recordView(pageId, variant, visitorId, now);

  const settings = siteSettingsSchema.safeParse(page.settings);
  if (settings.success && settings.data.capi) {
    await queueCapi("PageView", {
      eventId: `pv:${pageId}:${visitorId}:${klDay(now)}`,
      eventTime: now,
      sourceUrl: `https://${page.domain}${page.path === "/" ? "" : page.path}`,
      fbc: req.cookies.get("_fbc")?.value,
      fbp: req.cookies.get("_fbp")?.value,
      consent: false,
      clientIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  }
  const res = new Response(null, { status: 204 });
  if (visitorId !== existing) {
    res.headers.append("Set-Cookie", `lead_vid=${visitorId}; Max-Age=31536000; Path=/; SameSite=Lax; Secure; HttpOnly`);
  }
  return res;
}
