import { db } from "../sql.ts";
import { isPublicHost, PUBLIC_HOST } from "./host.ts";
import { parsePage } from "./tree-server.ts";
import { isUuid } from "./stats.ts";

// The HTML of an Embed block ("html" mode), served from its own address so the
// page's strict Content-Security-Policy does not apply to it (a srcdoc frame
// would inherit it and could run no script). Safe because:
//  - the page frames it with a sandbox that has no allow-same-origin, and
//  - this response carries its own `sandbox` directive, so even opened directly
//    in a tab it runs as an opaque origin: no cookies, no access to this site.
const EMBED_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation",
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "img-src https: data: blob:",
  "media-src https: data: blob:",
  "font-src https: data:",
  "connect-src https:",
  "frame-src https:",
  "worker-src blob:",
  "form-action https:",
  "frame-ancestors 'self'",
].join("; ");

const notFound = () => new Response("Not found", { status: 404 });

export function embedDocument(html: string): string {
  if (/^\s*(<!doctype|<html)/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0}body{font-family:system-ui,sans-serif}</style></head><body>${html}</body></html>`;
}

export async function handleEmbed(host: string, pageId: string, elementId: string): Promise<Response> {
  if (!isPublicHost(host) || !isUuid(pageId) || !/^[A-Za-z0-9_-]{1,80}$/.test(elementId)) return notFound();
  const [v] = await db()`
    SELECT v.project
    FROM sales.site_page p
    JOIN sales.site s ON s.id = p.site_id
    JOIN sales.page_version v ON v.id = p.active_version_id AND v.status = 'published'
    WHERE p.id = ${pageId} AND s.domain = ${PUBLIC_HOST}`;
  const parsed = v ? parsePage(v.project) : null;
  if (!parsed?.ok) return notFound();
  for (const sec of [...parsed.page.sections, ...parsed.page.popups.flatMap((p) => p.sections)])
    for (const r of sec.rows)
      for (const c of r.cols)
        for (const e of c.els) {
          if (e.id !== elementId || e.type !== "embed") continue;
          const p = e.props as { mode: string; html: string };
          if (p.mode !== "html" || !p.html.trim()) return notFound();
          return new Response(embedDocument(p.html), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": EMBED_CSP,
              "X-Content-Type-Options": "nosniff",
              "X-Robots-Tag": "noindex",
              "Referrer-Policy": "no-referrer",
              "Cache-Control": "public, max-age=0, must-revalidate",
              "Netlify-CDN-Cache-Control": "public, s-maxage=31536000, stale-while-revalidate=60",
              "Netlify-Cache-Tag": `page:${pageId}`,
            },
          });
        }
  return notFound();
}
