import { holdingHtml } from "@/lib/sites/holding";
import { pageResponse, resolve } from "@/lib/sites/serve";

export const dynamic = "force-dynamic";

// Public pages. Reached only through the proxy's rewrite from the public host;
// the proxy answers 404 to a direct request on the app host.
async function handle(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const r = await resolve(req.headers.get("host") ?? "", "/" + (path ?? []).join("/"));
  if (r.kind === "redirect") return new Response(null, { status: 301, headers: { Location: r.to } });
  if (r.kind === "page") return pageResponse(r);
  return new Response(holdingHtml(r.language), {
    status: r.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });
}

export const GET = handle;
export const HEAD = handle;
