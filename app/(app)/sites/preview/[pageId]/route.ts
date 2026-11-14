import { getCurrentUser } from "@/lib/auth/current-user";
import { canViewSites } from "@/lib/sites/permissions";
import { loadValues } from "@/lib/sites/custom-values";
import { renderDraft } from "@/lib/sites/render/html";
import { csp, newNonce, renderDocument, toSite } from "@/lib/sites/serve";
import { db } from "@/lib/sql";

export const dynamic = "force-dynamic";

// Draft preview on the app host, same renderer as the live page.
export async function GET(_req: Request, ctx: { params: Promise<{ pageId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !canViewSites(user.role)) return new Response("Not found", { status: 404 });
  const { pageId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) return new Response("Not found", { status: 404 });
  const [p] = await db()`
    SELECT v.project, p.id AS pid, p.site_id, s.id, s.domain, s.language, s.settings
    FROM sales.site_page p
    JOIN sales.page_version v ON v.page_id = p.id AND v.variant = 'A' AND v.status = 'draft'
    JOIN sales.site s ON s.id = p.site_id
    WHERE p.id = ${pageId}`;
  if (!p) return new Response("Not found", { status: 404 });
  const site = toSite(p as never);
  const steps = (await db()`SELECT id, path FROM sales.site_page WHERE site_id = ${p.site_id} ORDER BY position`) as unknown as { id: string; path: string }[];
  const tree = renderDraft(p.project, { site, steps, pageId });
  if (!tree.ok) return new Response(tree.message, { status: 422, headers: { "Cache-Control": "no-store" } });
  const nonce = newNonce();
  return new Response(renderDocument({ html: tree.html, css: tree.css, values: await loadValues() }, site, nonce), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
      "Content-Security-Policy": csp(nonce),
    },
  });
}
