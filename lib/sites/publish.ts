import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { db, withTransaction } from "../sql.ts";
import { guard } from "./admin.ts";
import { cleanPage } from "./clean.ts";
import { leadFormSettingsSchema, normalizePath, orderFormSettingsSchema, pathSchema, type SiteSettings } from "./model.ts";
import { purge } from "./purge.ts";
import { isRealDate } from "./workshop-name.ts";

export { setPurgeFetch } from "./purge.ts";

// Publish / unpublish / restore / history. site_route is written only here.

type Viewer = { id: string; role: Role };
type PageInfo = { id: string; siteId: string; path: string };
type SiteInfo = { domain: string; settings: SiteSettings };
export type PublishResult =
  | { kind: "ok"; removed: string[] }
  | { kind: "refused"; reasons: string[] }
  | { kind: "conflict" };

// ---- rendering and checks ----

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Scans the CLEANED html (sanitize-html serialises attributes uniformly): every
// <div data-lead="kind">, its data-settings decoded and parsed.
export function components(html: string, kind: "form" | "order" | "global-section") {
  const out: { settings: unknown; id: string }[] = [];
  for (const [tag] of html.matchAll(/<div\b[^>]*>/gi)) {
    if (/data-lead\s*=\s*["']?([a-z-]+)/i.exec(tag)?.[1]?.toLowerCase() !== kind) continue;
    const m = /data-settings\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    let settings: unknown;
    try {
      settings = m ? JSON.parse(decode(m[1] ?? m[2])) : undefined;
    } catch {
      settings = undefined;
    }
    out.push({ settings, id: dataId(tag) });
  }
  return out;
}

const GLOBAL_RE = /<div\b(?=[^>]*data-lead\s*=\s*["']?global-section["']?)[^>]*>\s*<\/div>/gi;
const dataId = (tag: string) => /data-id\s*=\s*["']?([0-9a-zA-Z-]*)/i.exec(tag)?.[1] ?? "";

// Inlines each known global section; a missing one is left in place and
// caught by publishCheck after cleaning.
async function renderGlobals(html: string, css: string) {
  const found = new Map<string, { html: string; css: string }>();
  for (const id of new Set([...html.matchAll(GLOBAL_RE)].map((m) => dataId(m[0])))) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    const [g] = await db()`SELECT html, css FROM sales.global_section WHERE id = ${id}`;
    if (g) found.set(id, g as { html: string; css: string });
  }
  let extra = "";
  const out = html.replace(GLOBAL_RE, (tag) => {
    const g = found.get(dataId(tag));
    if (!g) return tag;
    extra += `\n${g.css}`;
    return g.html;
  });
  return { html: out, css: css + extra };
}

const todayKL = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

// ponytail: image-over-limit is not checked here; images are size-checked at upload (Task 14).
export async function publishCheck(page: PageInfo, draft: { html: string }, site: SiteInfo): Promise<string[]> {
  const reasons: string[] = [];
  if (!site.settings?.privacyUrl) reasons.push("Add a privacy policy link in the site settings.");
  for (const g of components(draft.html, "global-section")) reasons.push(`Missing global section ${g.id || "(no id)"}.`);
  for (const { settings } of components(draft.html, "form")) {
    const r = leadFormSettingsSchema.safeParse(settings);
    if (!r.success) {
      reasons.push("A LEAD form is not fully set up.");
      continue;
    }
    const d = r.data.workshop?.date;
    if (d && isRealDate(d) && d < todayKL()) reasons.push(`The workshop date ${d} is in the past.`);
  }
  for (const { settings } of components(draft.html, "order")) {
    const r = orderFormSettingsSchema.safeParse(settings);
    if (!r.success || !r.data.classCode.trim()) reasons.push("An order form has no class chosen.");
  }
  const [taken] = await db()`
    SELECT 1 FROM sales.site_route r JOIN sales.site_page p ON p.id = r.page_id
    WHERE r.domain = ${site.domain} AND r.path = ${page.path} AND p.site_id <> ${page.siteId}`;
  if (taken) reasons.push(`The address ${page.path} is already used by another site.`);
  return reasons;
}

async function load(pageId: string) {
  const sql = db();
  const [p] = await sql`
    SELECT p.id, p.site_id, p.path, p.version, s.domain, s.settings
    FROM sales.site_page p JOIN sales.site s ON s.id = p.site_id
    WHERE p.id = ${pageId} FOR UPDATE OF p`;
  if (!p) throw new Error("No such step.");
  const [d] = await sql`
    SELECT project, html, css FROM sales.page_version
    WHERE page_id = ${pageId} AND variant = 'A' AND status = 'draft'`;
  return {
    page: { id: p.id as string, siteId: p.site_id as string, path: p.path as string },
    site: { domain: p.domain as string, settings: p.settings as SiteSettings },
    version: p.version as number,
    draft: (d ?? { project: {}, html: "", css: "" }) as { project: unknown; html: string; css: string },
  };
}

// Takes the route unless another site's page holds it (atomic: the conditional
// upsert returns no row if the existing owner is outside this site). Also
// reports a redirect target it replaced, for the audit trail.
export async function writeRoute(domain: string, page: PageInfo, pageId: string) {
  const sql = db();
  const [old] = await sql`SELECT redirect_to FROM sales.site_route WHERE domain = ${domain} AND path = ${page.path}`;
  const rows = await sql`
    INSERT INTO sales.site_route (domain, path, page_id, redirect_to) VALUES (${domain}, ${page.path}, ${pageId}, NULL)
    ON CONFLICT (domain, path) DO UPDATE SET page_id = EXCLUDED.page_id, redirect_to = NULL
    WHERE sales.site_route.page_id IS NULL
       OR sales.site_route.page_id IN (SELECT id FROM sales.site_page WHERE site_id = ${page.siteId})
    RETURNING path`;
  return { ok: rows.length > 0, replacedRedirect: (old?.redirect_to as string | null) ?? null };
}

// version undefined = skip the concurrency check (publishSite, restore).
async function publishOne(
  viewer: Viewer,
  pageId: string,
  version: number | undefined,
  dryRun: boolean,
  restoredFrom?: string,
): Promise<PublishResult> {
  const sql = db();
  const { page, site, version: cur, draft } = await load(pageId);
  if (version !== undefined && version !== cur) return { kind: "conflict" };
  // One writer per (domain, path) at a time: the check and the route write below
  // are then atomic against another site publishing the same path.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${site.domain + page.path}))`;
  const rendered = await renderGlobals(draft.html, draft.css);
  const clean = cleanPage(rendered.html, rendered.css);
  const reasons = await publishCheck(page, clean, site);
  if (reasons.length) return { kind: "refused", reasons };
  if (dryRun) return { kind: "ok", removed: [] };
  // A page whose path changed since last publish stops answering at the old path.
  await sql`
    UPDATE sales.site_route SET page_id = NULL
    WHERE page_id = ${pageId} AND NOT (domain = ${site.domain} AND path = ${page.path})`;
  const route = await writeRoute(site.domain, page, pageId);
  if (!route.ok) return { kind: "refused", reasons: [`The address ${page.path} is already used by another site.`] };
  const [prev] = await sql`
    UPDATE sales.page_version SET status = 'archived'
    WHERE page_id = ${pageId} AND variant = 'A' AND status = 'published' RETURNING id`;
  const [v] = await sql`
    INSERT INTO sales.page_version (page_id, project, html, css, status, published_by, published_at)
    VALUES (${pageId}, ${sql.json(draft.project as never)}, ${clean.html}, ${clean.css}, 'published', ${viewer.id}, now())
    RETURNING id`;
  await sql`UPDATE sales.site_page SET active_version_id = ${v.id}, version = version + 1, updated_at = now() WHERE id = ${pageId}`;
  await writeAudit({
    userId: viewer.id,
    action: "update",
    entity: "site_page",
    entityId: pageId,
    before: { versionId: prev?.id ?? null, replacedRedirect: route.replacedRedirect },
    after: { what: "publish", versionId: v.id, ...(restoredFrom ? { restoredFrom } : {}) },
  });
  return { kind: "ok", removed: clean.removed };
}

class Refused extends Error {
  out: PublishResult;
  constructor(out: PublishResult) {
    super("refused");
    this.out = out;
  }
}

// A transaction that a Refused throw rolls back, returning the refusal.
async function publishAll(fn: () => Promise<PublishResult>): Promise<PublishResult> {
  try {
    return await withTransaction(fn);
  } catch (e) {
    if (e instanceof Refused) return e.out;
    throw e;
  }
}

export async function publishPage(viewer: Viewer, pageId: string, version: number): Promise<PublishResult> {
  await guard(viewer, "publish a page", true);
  const r = await withTransaction(() => publishOne(viewer, pageId, version, false));
  if (r.kind === "ok") await purge([pageId]);
  return r;
}

// All pages or none: any refusal (or error) writes nothing.
export async function publishSite(viewer: Viewer, siteId: string): Promise<PublishResult> {
  await guard(viewer, "publish a site", true);
  let ids: string[] = [];
  const r = await publishAll(async (): Promise<PublishResult> => {
    const pages = await db()`SELECT id, name FROM sales.site_page WHERE site_id = ${siteId} ORDER BY position`;
    if (!pages.length) throw new Error("No such site.");
    const reasons: string[] = [];
    for (const p of pages) {
      const c = await publishOne(viewer, p.id, undefined, true);
      if (c.kind === "refused") reasons.push(...c.reasons.map((x) => `${p.name}: ${x}`));
    }
    if (reasons.length) return { kind: "refused", reasons };
    const removed: string[] = [];
    for (const p of pages) {
      const o = await publishOne(viewer, p.id, undefined, false);
      if (o.kind !== "ok") throw new Refused(o); // rolls back the pages already written
      removed.push(...o.removed);
    }
    ids = pages.map((p) => p.id as string);
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "site",
      entityId: siteId,
      before: null,
      after: { what: "publish", pageIds: ids },
    });
    return { kind: "ok", removed };
  });
  if (r.kind === "ok") await purge(ids);
  return r;
}

export async function unpublishPage(viewer: Viewer, pageId: string): Promise<void> {
  await guard(viewer, "unpublish a page", true);
  await withTransaction(async () => {
    const sql = db();
    const [p] = await sql`SELECT active_version_id FROM sales.site_page WHERE id = ${pageId} FOR UPDATE`;
    if (!p) throw new Error("No such step.");
    await sql`UPDATE sales.site_route SET page_id = NULL WHERE page_id = ${pageId}`;
    await sql`UPDATE sales.page_version SET status = 'archived' WHERE page_id = ${pageId} AND status = 'published'`;
    await sql`UPDATE sales.site_page SET active_version_id = NULL, version = version + 1, updated_at = now() WHERE id = ${pageId}`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "site_page",
      entityId: pageId,
      before: { versionId: p.active_version_id },
      after: { what: "unpublish" },
    });
  });
  await purge([pageId]);
}

export async function listVersions(viewer: Viewer, pageId: string) {
  await guard(viewer, "view sites", false);
  const rows = await db()`
    SELECT v.id, v.variant, v.status, v.published_at, u.full_name AS published_by
    FROM sales.page_version v LEFT JOIN app_user u ON u.id = v.published_by
    WHERE v.page_id = ${pageId} AND v.status <> 'draft'
    ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC`;
  return rows.map((r) => ({
    id: r.id as string,
    variant: r.variant as string,
    status: r.status as "published" | "archived",
    publishedAt: r.published_at as Date | null,
    publishedBy: r.published_by as string | null,
  }));
}

// Copies the chosen version into the draft, then publishes the draft. `version`
// is the page's current version (stale = conflict). A refused or conflicting
// publish rolls the draft copy back too.
export async function restoreVersion(
  viewer: Viewer,
  pageId: string,
  versionId: string,
  version: number,
): Promise<PublishResult> {
  await guard(viewer, "restore a version", true);
  let r: PublishResult;
  try {
    r = await withTransaction(async () => {
      const sql = db();
      const [v] = await sql`
        SELECT project, html, css FROM sales.page_version
        WHERE id = ${versionId} AND page_id = ${pageId} AND status <> 'draft'`;
      if (!v) throw new Error("No such version.");
      await sql`
        INSERT INTO sales.page_version (page_id, project, html, css)
        VALUES (${pageId}, ${sql.json(v.project)}, ${v.html}, ${v.css})
        ON CONFLICT (page_id, variant) WHERE status = 'draft'
        DO UPDATE SET project = EXCLUDED.project, html = EXCLUDED.html, css = EXCLUDED.css`;
      const out = await publishOne(viewer, pageId, version, false, versionId);
      if (out.kind !== "ok") throw new Refused(out);
      return out;
    });
  } catch (e) {
    if (e instanceof Refused) return e.out;
    throw e;
  }
  await purge([pageId]);
  return r;
}

// Old GHL paths during cutover: `to` is an https URL or a same-domain path.
export async function setRedirect(viewer: Viewer, domain: string, path: string, to: string): Promise<void> {
  await guard(viewer, "set a redirect", true);
  const p = normalizePath(path);
  if (!pathSchema.safeParse(p).success) throw new Error(`Invalid path: ${path}`);
  if (to.includes("\\") || (!/^https:\/\/\S+$/.test(to) && !/^\/(?!\/)\S*$/.test(to))) {
    throw new Error("Redirect target must be an https URL or a path.");
  }
  await withTransaction(async () => {
    const sql = db();
    const [live] = await sql`SELECT page_id FROM sales.site_route WHERE domain = ${domain} AND path = ${p}`;
    if (live?.page_id) throw new Error("A live page owns this path; unpublish it first.");
    await sql`
      INSERT INTO sales.site_route (domain, path, page_id, redirect_to) VALUES (${domain}, ${p}, NULL, ${to})
      ON CONFLICT (domain, path) DO UPDATE SET page_id = NULL, redirect_to = EXCLUDED.redirect_to`;
    await writeAudit({
      userId: viewer.id,
      action: "update",
      entity: "site_route",
      entityId: null,
      before: null,
      after: { what: "redirect", domain, path: p, to },
    });
  });
}
