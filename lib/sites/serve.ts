import { randomBytes } from "node:crypto";
import { db } from "../sql.ts";
import { FONTS_URL } from "./fonts.ts";
import { holdingHtml } from "./holding.ts";
import { isPublicHost, PUBLIC_HOST } from "./host.ts";
import { normalizePath, siteSettingsSchema, type SiteSettings } from "./model.ts";

export { PUBLIC_HOST, isPublicHost };

export type SiteRow = { id: string; domain: string; language: "en" | "zh"; settings: SiteSettings };
export type Resolved =
  | { kind: "page"; pageId: string; html: string; css: string; site: SiteRow }
  | { kind: "redirect"; to: string }
  | { kind: "holding"; language: "en" | "zh"; status: 200 | 404 };

export const toSite = (r: { id: string; domain: string; language: "en" | "zh"; settings: unknown }): SiteRow => {
  const s = siteSettingsSchema.safeParse(r.settings);
  return {
    id: r.id,
    domain: r.domain,
    language: r.language,
    settings: s.success ? s.data : { pixels: {}, capi: false, paymentMode: "test", seo: {} },
  };
};

// `host` is accepted for the interface; site.localhost (dev) serves the same
// routes as production, so there is one domain to look up.
export async function resolve(_host: string, rawPath: string): Promise<Resolved> {
  const domain = PUBLIC_HOST;
  const path = normalizePath(rawPath);
  const sql = db();
  const [r] = await sql`SELECT page_id, redirect_to FROM sales.site_route WHERE domain = ${domain} AND path = ${path}`;
  if (r?.redirect_to) return { kind: "redirect", to: r.redirect_to };
  if (r?.page_id) {
    const [p] = await sql`
      SELECT v.html, v.css, s.id, s.domain, s.language, s.settings
      FROM sales.site_page p
      JOIN sales.page_version v ON v.id = p.active_version_id AND v.status = 'published'
      JOIN sales.site s ON s.id = p.site_id
      WHERE p.id = ${r.page_id}`;
    if (p) return { kind: "page", pageId: r.page_id, html: p.html, css: p.css, site: toSite(p as never) };
  }
  // Unpublished (route kept, no page): holding page. Unknown path: holding + 404.
  const [s] = await sql`
    SELECT language FROM sales.site
    WHERE domain = ${domain} AND (${path} = base_path OR ${path} LIKE base_path || '/%')
    ORDER BY length(base_path) DESC LIMIT 1`;
  return { kind: "holding", language: (s?.language as "en" | "zh") ?? "en", status: r ? 200 : 404 };
}

// ---- document ----

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const newNonce = () => randomBytes(16).toString("base64");

function pixels(p: SiteSettings["pixels"], nonce: string): string {
  const out: string[] = [];
  const tag = (js: string) => `<script nonce="${nonce}">${js}</script>`;
  if (p.meta && ID_RE.test(p.meta)) {
    out.push(
      tag(
        `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${p.meta}');fbq('track','PageView');`,
      ),
    );
  }
  if (p.google && /^(G|AW)-/.test(p.google) && ID_RE.test(p.google)) {
    out.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${p.google}"></script>`,
      tag(`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${p.google}');`),
    );
  }
  if (p.linkedin && ID_RE.test(p.linkedin)) {
    out.push(
      tag(
        `_linkedin_partner_id='${p.linkedin}';window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName('script')[0];var b=document.createElement('script');b.type='text/javascript';b.async=true;b.src='https://snap.licdn.com/li.lms-analytics/insight.min.js';s.parentNode.insertBefore(b,s)})(window.lintrk);`,
      ),
    );
  }
  if (p.tiktok && ID_RE.test(p.tiktok)) {
    out.push(
      tag(
        `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n='https://analytics.tiktok.com/i18n/pixel/events.js';ttq._i=ttq._i||{};ttq._i[e]=[];ttq._t=ttq._t||{};ttq._t[e]=+new Date;var o=d.createElement('script');o.type='text/javascript';o.async=!0;o.src=n+'?sdkid='+e+'&lib='+t;var a=d.getElementsByTagName('script')[0];a.parentNode.insertBefore(o,a)};ttq.load('${p.tiktok}');ttq.page()}(window,document,'ttq');`,
      ),
    );
  }
  return out.join("");
}

// ponytail: no page-level SEO or linked-language model exists yet, so only
// site SEO is used and `alternates` is supplied by the caller (none today).
export function renderDocument(
  page: { html: string; css: string; pageId?: string },
  site: Pick<SiteRow, "language" | "settings">,
  nonce: string,
  opts: { alternates?: { lang: string; url: string }[] } = {},
): string {
  const { seo, favicon, pixels: px } = site.settings;
  const meta = [
    page.pageId && `<meta name="lead-page" content="${esc(page.pageId)}"><meta name="lead-variant" content="A">`,
    seo.description && `<meta name="description" content="${esc(seo.description)}">`,
    seo.title && `<meta property="og:title" content="${esc(seo.title)}">`,
    seo.description && `<meta property="og:description" content="${esc(seo.description)}">`,
    seo.image && `<meta property="og:image" content="${esc(seo.image)}">`,
    seo.noindex && `<meta name="robots" content="noindex">`,
    favicon && `<link rel="icon" href="${esc(favicon)}">`,
    ...(opts.alternates ?? []).map((a) => `<link rel="alternate" hreflang="${esc(a.lang)}" href="${esc(a.url)}">`),
  ].filter(Boolean);
  const key = process.env.TURNSTILE_SITE_KEY ?? "";
  const turnstile = /^[0-9A-Za-z_-]{10,100}$/.test(key) ? ` data-turnstile="${esc(key)}"` : "";
  return `<!doctype html><html lang="${site.language}"${turnstile}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(seo.title ?? "")}</title>${meta.join("")}<link rel="stylesheet" href="${FONTS_URL}"><style>${page.css.replace(/<\/style/gi, "<\\/style")}</style>${pixels(px, nonce)}</head><body>${page.html}<script src="/site/runtime.js" defer></script></body></html>`;
}

export function csp(nonce: string): string {
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://connect.facebook.net https://www.googletagmanager.com https://snap.licdn.com https://analytics.tiktok.com https://challenges.cloudflare.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com https://challenges.cloudflare.com; img-src 'self' data: https:; connect-src 'self' https://www.facebook.com https://connect.facebook.net https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.doubleclick.net https://px.ads.linkedin.com https://analytics.tiktok.com https://*.tiktok.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`;
}

export function pageResponse(r: Extract<Resolved, { kind: "page" }>): Response {
  const nonce = newNonce();
  const h = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "public, s-maxage=31536000, stale-while-revalidate=60",
    "Netlify-Cache-Tag": `page:${r.pageId}`,
    "Content-Security-Policy": csp(nonce),
  });
  if (r.site.settings.seo.noindex) h.set("X-Robots-Tag", "noindex");
  return new Response(renderDocument(r, r.site, nonce), { headers: h });
}

// The render route's whole behaviour, so it is testable and refuses on its own
// when reached on a non-public host (not only through the proxy's path check).
export async function handleRender(host: string, path: string): Promise<Response> {
  if (!isPublicHost(host)) return new Response("Not found", { status: 404 });
  const r = await resolve(host, path);
  if (r.kind === "redirect") {
    return new Response(null, { status: 301, headers: { Location: r.to, "Cache-Control": "public, max-age=300" } });
  }
  if (r.kind === "page") return pageResponse(r);
  return new Response(holdingHtml(r.language), {
    status: r.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });
}
