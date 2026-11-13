import type { NextRequest } from "next/server";
import { checkView, clientIp, isUuid, recordView } from "@/lib/sites/stats";

export const dynamic = "force-dynamic";

// A page view from the public runtime: POST {pageId, variant}. Counts it
// (views / uniques); the browser pixel owns PageView, the server sends no
// PageView to CAPI. The decision (host, origin, rate limit, page and variant) is checkView's.
// Visitor id: the first-party cookie lead_vid.
export async function POST(req: NextRequest) {
  let body: { pageId?: unknown; variant?: unknown } = {};
  try {
    body = await req.json();
  } catch {}
  const d = await checkView({
    host: req.headers.get("host") ?? "",
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    ip: clientIp(req.headers),
    pageId: body?.pageId,
    variant: body?.variant,
  });
  if (d.kind === "notfound") return new Response("Not found", { status: 404 });
  if (d.kind === "bad") return new Response("Bad request", { status: 400 });
  if (d.kind === "forbidden") return new Response("Forbidden", { status: 403 });
  if (d.kind !== "ok") return new Response(null, { status: 204 });
  const pageId = body.pageId as string;

  const existing = req.cookies.get("lead_vid")?.value;
  const visitorId = isUuid(existing) ? existing : crypto.randomUUID();
  const now = new Date();
  await recordView(pageId, body.variant as string, visitorId, now);

  const res = new Response(null, { status: 204 });
  if (visitorId !== existing) {
    res.headers.append("Set-Cookie", `lead_vid=${visitorId}; Max-Age=31536000; Path=/; SameSite=Lax; Secure; HttpOnly`);
  }
  return res;
}
