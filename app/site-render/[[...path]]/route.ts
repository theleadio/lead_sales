import { handleRender } from "@/lib/sites/serve";

export const dynamic = "force-dynamic";

// Public pages. Reached through the proxy's rewrite from the public host;
// handleRender also refuses any other host.
async function handle(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  return handleRender(req.headers.get("host") ?? "", "/" + (path ?? []).join("/"));
}

export const GET = handle;
export const HEAD = handle;
