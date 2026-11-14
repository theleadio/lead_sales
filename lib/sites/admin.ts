import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { z } from "zod";
import { db, withTransaction } from "../sql.ts";
import { normalizePath, pathSchema, siteSettingsSchema, type SiteSettings } from "./model.ts";
import { canEditSites, canViewSites } from "./permissions.ts";
import { purge } from "./purge.ts";
import { parsePage, sanitizePage } from "./tree-server.ts";

// Server-side data layer for the sites admin screens and the editor. Every
// function takes the viewer first; a refusal is audited and throws.

type Viewer = { id: string; role: Role };
type Sql = ReturnType<typeof db>;
export type Kind = "funnel" | "website";
export type Result = { kind: "ok"; version: number } | { kind: "conflict" };
const CONFLICT: Result = { kind: "conflict" };
const LOCK_INTERVAL = "2 minutes";

export class SitesPermissionError extends Error {
  constructor(what: string) {
    super(`Not allowed to ${what}.`);
  }
}

export async function guard(v: Viewer, what: string, edit: boolean) {
  if ((edit ? canEditSites : canViewSites)(v.role)) return;
  await writeAudit({
    userId: v.id,
    action: "permission_denied",
    entity: "site",
    entityId: null,
    before: null,
    after: { what },
  });
  throw new SitesPermissionError(what);
}

function cleanPath(input: string): string {
  const p = normalizePath(input);
  if (!pathSchema.safeParse(p).success) throw new Error(`Invalid path: ${input}`);
  return p;
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 120) throw new Error("A name of up to 120 characters.");
  return n;
}

const sub = (base: string, rest: string) => (base === "/" ? rest || "/" : base + rest);

// Bumps the site version if `version` is still current; null = conflict.
async function bumpSite(v: Viewer, siteId: string, version: number) {
  const [r] = await db()`
    UPDATE sales.site SET version = version + 1, updated_at = now(), updated_by = ${v.id}
    WHERE id = ${siteId} AND version = ${version} RETURNING version`;
  return r ? (r.version as number) : null;
}

const audit = (
  v: Viewer,
  action: "create" | "update" | "delete",
  entity: string,
  id: string,
  before: unknown,
  after: unknown,
) => writeAudit({ userId: v.id, action, entity, entityId: id, before, after });

export type SiteRow = {
  id: string;
  name: string;
  kind: Kind;
  folderId: string | null;
  folderName: string | null;
  steps: number;
  liveUrl: string;
  updatedAt: Date;
};

export async function listSites(viewer: Viewer, kind: Kind): Promise<SiteRow[]> {
  await guard(viewer, "view sites", false);
  const rows = await db()`
    SELECT s.id, s.name, s.kind, s.folder_id, f.name AS folder_name, s.updated_at, s.domain,
           (SELECT count(*)::int FROM sales.site_page p WHERE p.site_id = s.id) AS steps,
           (SELECT p.path FROM sales.site_page p WHERE p.site_id = s.id ORDER BY p.position LIMIT 1) AS first_path
    FROM sales.site s LEFT JOIN sales.site_folder f ON f.id = s.folder_id
    WHERE s.kind = ${kind} ORDER BY s.updated_at DESC`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    folderId: r.folder_id,
    folderName: r.folder_name,
    steps: r.steps,
    liveUrl: `https://${r.domain}${!r.first_path || r.first_path === "/" ? "" : r.first_path}`,
    updatedAt: r.updated_at,
  }));
}

const templateSchema = z.object({
  steps: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        kind: z.enum(["page", "checkout", "thank_you"]),
        suffix: z.string(),
        project: z.unknown().optional(),
        html: z.string().optional(),
        css: z.string().optional(),
      }),
    )
    .min(1),
});

type StepSeed = { name: string; kind: string; suffix: string; project: unknown; html: string; css: string };
const DEFAULT_STEPS: StepSeed[] = [
  { name: "Home", kind: "page", suffix: "" },
  { name: "Payment Form", kind: "checkout", suffix: "/payment" },
  { name: "Thank You", kind: "thank_you", suffix: "/thank-you" },
].map((s) => ({ ...s, project: {}, html: "", css: "" }));

export async function createFunnel(
  viewer: Viewer,
  input: { name: string; folderId?: string; language: "en" | "zh"; basePath: string; templateId?: string },
): Promise<{ siteId: string }> {
  await guard(viewer, "create a funnel", true);
  const name = cleanName(input.name);
  const basePath = cleanPath(input.basePath);
  if (input.language !== "en" && input.language !== "zh") throw new Error("Unknown language.");
  return withTransaction(async () => {
    const sql = db();
    let steps = DEFAULT_STEPS;
    if (input.templateId) {
      const [t] = await sql`SELECT payload FROM sales.site_template WHERE id = ${input.templateId} AND kind = 'funnel'`;
      if (!t) throw new Error("No such template.");
      const ok = templateSchema.safeParse(t.payload);
      if (!ok.success) throw new Error("This template is damaged and cannot be used.");
      steps = ok.data.steps as StepSeed[];
    }
    const [s] = await sql`
      INSERT INTO sales.site (kind, name, folder_id, base_path, language, created_by, updated_by)
      VALUES ('funnel', ${name}, ${input.folderId ?? null}, ${basePath}, ${input.language}, ${viewer.id}, ${viewer.id})
      RETURNING id`;
    for (const [i, st] of steps.entries()) {
      const [p] = await sql`
        INSERT INTO sales.site_page (site_id, position, name, path, kind)
        VALUES (${s.id}, ${i + 1}, ${st.name}, ${cleanPath(sub(basePath, st.suffix))}, ${st.kind}) RETURNING id`;
      await sql`
        INSERT INTO sales.page_version (page_id, project, html, css)
        VALUES (${p.id}, ${sql.json((st.project ?? {}) as never)}, ${st.html ?? ""}, ${st.css ?? ""})`;
    }
    await audit(viewer, "create", "site", s.id, null, { name, basePath, templateId: input.templateId ?? null });
    return { siteId: s.id as string };
  });
}

export async function getSite(viewer: Viewer, siteId: string) {
  await guard(viewer, "view sites", false);
  const sql = db();
  const [s] = await sql`SELECT * FROM sales.site WHERE id = ${siteId}`;
  if (!s) return null;
  const pages = await sql`
    SELECT p.id, p.position, p.name, p.path, p.kind, p.version,
           (SELECT r.path FROM sales.site_route r WHERE r.page_id = p.id LIMIT 1) AS live_path
    FROM sales.site_page p
    WHERE p.site_id = ${siteId} ORDER BY p.position`;
  return {
    id: s.id as string,
    kind: s.kind as Kind,
    name: s.name as string,
    folderId: s.folder_id as string | null,
    domain: s.domain as string,
    basePath: s.base_path as string,
    language: s.language as "en" | "zh",
    settings: s.settings as SiteSettings,
    version: s.version as number,
    steps: pages.map((p) => ({
      id: p.id as string,
      position: p.position as number,
      name: p.name as string,
      path: p.path as string,
      kind: p.kind as string,
      version: p.version as number,
      livePath: (p.live_path as string | null) ?? null,
    })),
  };
}

export async function updateSiteSettings(
  viewer: Viewer,
  siteId: string,
  settings: SiteSettings,
  version: number,
): Promise<Result> {
  await guard(viewer, "change site settings", true);
  const parsed = siteSettingsSchema.parse(settings);
  const r = await withTransaction(async (): Promise<Result> => {
    const sql = db();
    const [before] = await sql`SELECT settings FROM sales.site WHERE id = ${siteId} FOR UPDATE`;
    if (!before) throw new Error("No such site.");
    const v = await bumpSite(viewer, siteId, version);
    if (v === null) return CONFLICT;
    await sql`UPDATE sales.site SET settings = ${sql.json(parsed as never)} WHERE id = ${siteId}`;
    await audit(viewer, "update", "site", siteId, { settings: before.settings }, { settings: parsed });
    return { kind: "ok", version: v };
  });
  // Pages bake the settings (pixels, SEO, favicon) into cached HTML.
  if (r.kind === "ok") {
    const live = await db()`SELECT id FROM sales.site_page WHERE site_id = ${siteId} AND active_version_id IS NOT NULL`;
    await purge(live.map((p) => p.id as string));
  }
  return r;
}

// ---- steps: each takes the site's version and bumps it ----

async function stepOp(
  viewer: Viewer,
  siteId: string,
  version: number,
  what: string,
  fn: (sql: Sql) => Promise<object>,
): Promise<Result> {
  await guard(viewer, what, true);
  return withTransaction(async () => {
    const sql = db();
    const [s] = await sql`SELECT id FROM sales.site WHERE id = ${siteId} FOR UPDATE`;
    if (!s) throw new Error("No such site.");
    const v = await bumpSite(viewer, siteId, version);
    if (v === null) return CONFLICT;
    const detail = await fn(sql);
    await audit(viewer, "update", "site", siteId, null, { what, ...detail });
    return { kind: "ok", version: v };
  });
}

async function pagesOf(sql: Sql, siteId: string) {
  const rows = await sql`SELECT id FROM sales.site_page WHERE site_id = ${siteId} ORDER BY position`;
  return rows.map((r) => r.id as string);
}

// Plain UPDATEs: UNIQUE (site_id, position) is deferred to commit.
async function renumber(sql: Sql, ids: string[]) {
  for (const [i, id] of ids.entries()) await sql`UPDATE sales.site_page SET position = ${i + 1} WHERE id = ${id}`;
}

export async function addStep(
  viewer: Viewer,
  siteId: string,
  version: number,
  input: { name: string; path: string; kind?: "page" | "checkout" | "thank_you" },
) {
  await guard(viewer, "add step", true);
  const name = cleanName(input.name);
  const path = cleanPath(input.path);
  return stepOp(viewer, siteId, version, "add step", async (sql) => {
    const [{ n }] = await sql`SELECT coalesce(max(position), 0)::int AS n FROM sales.site_page WHERE site_id = ${siteId}`;
    const [p] = await sql`
      INSERT INTO sales.site_page (site_id, position, name, path, kind)
      VALUES (${siteId}, ${n + 1}, ${name}, ${path}, ${input.kind ?? "page"}) RETURNING id`;
    await sql`INSERT INTO sales.page_version (page_id) VALUES (${p.id})`;
    return { pageId: p.id, name, path };
  });
}

// Changes a step's path. A published step keeps its live route until it is
// republished (site_route is written only by publish).
export async function setStepPath(viewer: Viewer, siteId: string, version: number, pageId: string, path: string) {
  await guard(viewer, "change step path", true);
  const p = cleanPath(path);
  return withTransaction(async () => {
    const sql = db();
    const [s] = await sql`SELECT id FROM sales.site WHERE id = ${siteId} FOR UPDATE`;
    if (!s) throw new Error("No such site.");
    const [cur] = await sql`SELECT path FROM sales.site_page WHERE id = ${pageId} AND site_id = ${siteId}`;
    if (!cur) throw new Error("No such step.");
    const [dup] = await sql`SELECT 1 FROM sales.site_page WHERE site_id = ${siteId} AND path = ${p} AND id <> ${pageId}`;
    if (dup) throw new Error("Another step already uses that path.");
    const v = await bumpSite(viewer, siteId, version);
    if (v === null) return CONFLICT;
    await sql`UPDATE sales.site_page SET path = ${p}, updated_at = now() WHERE id = ${pageId}`;
    await audit(viewer, "update", "site_page", pageId, { path: cur.path }, { path: p });
    return { kind: "ok", version: v } as Result;
  });
}

export async function moveStep(viewer: Viewer, siteId: string, version: number, pageId: string, toPosition: number) {
  return stepOp(viewer, siteId, version, "move step", async (sql) => {
    const ids = await pagesOf(sql, siteId);
    const from = ids.indexOf(pageId);
    if (from < 0) throw new Error("No such step.");
    ids.splice(from, 1);
    ids.splice(Math.min(Math.max(toPosition, 1), ids.length + 1) - 1, 0, pageId);
    await renumber(sql, ids);
    return { pageId, toPosition };
  });
}

export async function renameStep(viewer: Viewer, siteId: string, version: number, pageId: string, name: string) {
  await guard(viewer, "rename step", true);
  const n = cleanName(name);
  return stepOp(viewer, siteId, version, "rename step", async (sql) => {
    const r = await sql`
      UPDATE sales.site_page SET name = ${n}, updated_at = now()
      WHERE id = ${pageId} AND site_id = ${siteId} RETURNING id`;
    if (!r.length) throw new Error("No such step.");
    return { pageId, name: n };
  });
}

export async function deleteStep(viewer: Viewer, siteId: string, version: number, pageId: string) {
  return stepOp(viewer, siteId, version, "delete step", async (sql) => {
    const r = await sql`DELETE FROM sales.site_page WHERE id = ${pageId} AND site_id = ${siteId} RETURNING id`;
    if (!r.length) throw new Error("No such step.");
    await renumber(sql, await pagesOf(sql, siteId));
    return { pageId, deleted: true };
  });
}

// The copy goes right after the original, at "<path>-copy" (or -copy-2, ...).
export async function cloneStep(viewer: Viewer, siteId: string, version: number, pageId: string) {
  return stepOp(viewer, siteId, version, "clone step", async (sql) => {
    const [src] = await sql`SELECT * FROM sales.site_page WHERE id = ${pageId} AND site_id = ${siteId}`;
    if (!src) throw new Error("No such step.");
    const taken = new Set(
      (await sql`SELECT path FROM sales.site_page WHERE site_id = ${siteId}`).map((r) => r.path as string),
    );
    const stem = src.path === "/" ? "" : (src.path as string);
    let path = `${stem}-copy`;
    for (let i = 2; taken.has(path); i++) path = `${stem}-copy-${i}`;
    path = cleanPath(path);
    const ids = await pagesOf(sql, siteId);
    const [p] = await sql`
      INSERT INTO sales.site_page (site_id, position, name, path, kind)
      VALUES (${siteId}, ${ids.length + 1}, ${`${src.name} copy`.slice(0, 120)}, ${path}, ${src.kind}) RETURNING id`;
    await sql`
      INSERT INTO sales.page_version (page_id, project, html, css)
      SELECT ${p.id}, project, html, css FROM sales.page_version
      WHERE page_id = ${pageId} AND variant = 'A' AND status = 'draft'`;
    ids.splice(ids.indexOf(pageId) + 1, 0, p.id);
    await renumber(sql, ids);
    return { pageId: p.id, clonedFrom: pageId, path };
  });
}

// ---- drafts and the edit lock ----

export async function getDraft(viewer: Viewer, pageId: string) {
  await guard(viewer, "view sites", false);
  const [r] = await db()`
    SELECT p.version, p.site_id, p.name, p.path, v.project, v.html, v.css, u.full_name AS holder
    FROM sales.site_page p
    LEFT JOIN sales.page_version v ON v.page_id = p.id AND v.variant = 'A' AND v.status = 'draft'
    LEFT JOIN app_user u ON u.id = p.edit_lock_user_id AND p.edit_lock_user_id <> ${viewer.id}
         AND p.edit_lock_at > now() - ${LOCK_INTERVAL}::interval
    WHERE p.id = ${pageId}`;
  if (!r) throw new Error("No such step.");
  return {
    siteId: r.site_id as string,
    name: r.name as string,
    path: r.path as string,
    project: (r.project ?? {}) as unknown,
    html: (r.html ?? "") as string,
    css: (r.css ?? "") as string,
    version: r.version as number,
    lockedBy: (r.holder as string | null) ?? null,
  };
}


// Stores the page tree. html/css are not stored on drafts: publish and preview
// render them from the tree. An invalid tree is refused, nothing is written.
export async function saveDraft(
  viewer: Viewer,
  pageId: string,
  draft: { project: unknown },
  version: number,
): Promise<Result | { kind: "locked"; holder: string } | { kind: "invalid"; message: string }> {
  await guard(viewer, "edit a page", true);
  const parsed = parsePage(draft.project);
  if (!parsed.ok) return { kind: "invalid", message: parsed.message };
  const project = sanitizePage(parsed.page);
  return withTransaction(async () => {
    const sql = db();
    // Someone else holds a fresh lock (e.g. took over): this editor must stop.
    const [l] = await sql`
      SELECT p.edit_lock_user_id AS uid, u.full_name AS name,
             coalesce(p.edit_lock_at > now() - ${LOCK_INTERVAL}::interval, false) AS fresh
      FROM sales.site_page p LEFT JOIN app_user u ON u.id = p.edit_lock_user_id
      WHERE p.id = ${pageId} FOR UPDATE OF p`;
    if (l?.uid && l.uid !== viewer.id && l.fresh) return { kind: "locked", holder: l.name as string };
    const [p] = await sql`
      UPDATE sales.site_page
      SET version = version + 1, updated_at = now(), edit_lock_user_id = ${viewer.id}, edit_lock_at = now()
      WHERE id = ${pageId} AND version = ${version} RETURNING version, site_id`;
    if (!p) return CONFLICT;
    await sql`
      INSERT INTO sales.page_version (page_id, project, html, css)
      VALUES (${pageId}, ${sql.json(project as never)}, '', '')
      ON CONFLICT (page_id, variant) WHERE status = 'draft'
      DO UPDATE SET project = EXCLUDED.project, html = '', css = ''`;
    await sql`UPDATE sales.site SET updated_at = now(), updated_by = ${viewer.id} WHERE id = ${p.site_id}`;
    return { kind: "ok", version: p.version as number };
  });
}

// Soft lock: held while edit_lock_at is under 2 minutes old (saveDraft
// refreshes it). Returns another user still holding it, else takes it.
export async function takeEditLock(viewer: Viewer, pageId: string, opts: { force?: boolean } = {}) {
  await guard(viewer, "edit a page", true);
  return withTransaction(async () => {
    const sql = db();
    const [p] = await sql`
      SELECT p.edit_lock_user_id AS uid, u.full_name AS name,
             coalesce(p.edit_lock_at > now() - ${LOCK_INTERVAL}::interval, false) AS fresh
      FROM sales.site_page p LEFT JOIN app_user u ON u.id = p.edit_lock_user_id
      WHERE p.id = ${pageId} FOR UPDATE OF p`;
    if (!p) throw new Error("No such step.");
    const other = p.uid && p.uid !== viewer.id && p.fresh;
    if (other && !opts.force) return { holder: { id: p.uid as string, name: p.name as string } };
    // A take-over also bumps the version, so the displaced editor's next save conflicts even if the lock check were skipped.
    await sql`
      UPDATE sales.site_page
      SET edit_lock_user_id = ${viewer.id}, edit_lock_at = now(), version = version + ${other ? 1 : 0}
      WHERE id = ${pageId}`;
    if (other)
      await audit(viewer, "update", "site_page", pageId, { lockHolderId: p.uid }, { lockHolderId: viewer.id });
    return { holder: null };
  });
}

// ---- folders, templates, global sections ----

export async function createFolder(viewer: Viewer, kind: Kind, name: string) {
  await guard(viewer, "create a folder", true);
  const n = cleanName(name);
  const [f] = await db()`INSERT INTO sales.site_folder (name, kind) VALUES (${n}, ${kind}) RETURNING id`;
  await audit(viewer, "create", "site_folder", f.id, null, { name: n, kind });
  return { folderId: f.id as string };
}

export async function listFolders(viewer: Viewer, kind: Kind) {
  await guard(viewer, "view sites", false);
  const rows = await db()`SELECT id, name FROM sales.site_folder WHERE kind = ${kind} ORDER BY name`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
}

// A funnel template: each step's draft, with its path relative to basePath.
export async function saveTemplate(viewer: Viewer, siteId: string, name: string) {
  await guard(viewer, "save a template", true);
  const n = cleanName(name);
  return withTransaction(async () => {
    const sql = db();
    const [s] = await sql`SELECT base_path FROM sales.site WHERE id = ${siteId} AND kind = 'funnel'`;
    if (!s) throw new Error("No such funnel.");
    const pages = await sql`
      SELECT p.name, p.kind, p.path, coalesce(v.project, '{}') AS project,
             coalesce(v.html, '') AS html, coalesce(v.css, '') AS css
      FROM sales.site_page p
      LEFT JOIN sales.page_version v ON v.page_id = p.id AND v.variant = 'A' AND v.status = 'draft'
      WHERE p.site_id = ${siteId} ORDER BY p.position`;
    const base = s.base_path === "/" ? "" : (s.base_path as string);
    const suffixOf = (b: string, path: string) => {
      if (path === b || (b === "" && path === "/")) return "";
      if (path.startsWith(`${b}/`)) return path.slice(b.length);
      throw new Error(`Step path ${path} is outside the funnel's base path.`);
    };
    const steps = pages.map((p) => ({
      name: p.name,
      kind: p.kind,
      suffix: suffixOf(base, p.path as string),
      project: p.project,
      html: p.html,
      css: p.css,
    }));
    const [t] = await sql`
      INSERT INTO sales.site_template (kind, name, payload) VALUES ('funnel', ${n}, ${sql.json({ steps } as never)})
      RETURNING id`;
    await audit(viewer, "create", "site_template", t.id, null, { name: n, siteId });
    return { templateId: t.id as string };
  });
}

export async function listTemplates(viewer: Viewer, kind: "funnel" | "website" | "section" = "funnel") {
  await guard(viewer, "view sites", false);
  const rows = await db()`SELECT id, name, created_at FROM sales.site_template WHERE kind = ${kind} ORDER BY name`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, createdAt: r.created_at as Date }));
}

// Prebuilt sections for the editor's Add panel: payload is { html, css }.
export async function listSectionTemplates(viewer: Viewer) {
  await guard(viewer, "view sites", false);
  const rows = await db()`SELECT id, name, payload FROM sales.site_template WHERE kind = 'section' ORDER BY name`;
  return rows.flatMap((r) => {
    const p = r.payload as { html?: unknown; css?: unknown } | null;
    return typeof p?.html === "string"
      ? [{ id: r.id as string, name: r.name as string, html: p.html, css: typeof p.css === "string" ? p.css : "" }]
      : [];
  });
}

export async function listGlobalSections(viewer: Viewer) {
  await guard(viewer, "view sites", false);
  const rows = await db()`SELECT id, name, project, html, css, version FROM sales.global_section ORDER BY name`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    project: r.project as unknown,
    html: r.html as string,
    css: r.css as string,
    version: r.version as number,
  }));
}

// No id = create (version 1). With id, `version` must still be current.
export async function saveGlobalSection(
  viewer: Viewer,
  input: { id?: string; name: string; project: unknown; html: string; css: string },
  version?: number,
): Promise<Result & { id?: string }> {
  await guard(viewer, "save a global section", true);
  const name = cleanName(input.name);
  const sql = db();
  const proj = sql.json(input.project as never);
  if (!input.id) {
    const [g] = await sql`
      INSERT INTO sales.global_section (name, project, html, css)
      VALUES (${name}, ${proj}, ${input.html}, ${input.css}) RETURNING id`;
    await audit(viewer, "create", "global_section", g.id, null, { name });
    return { kind: "ok", version: 1, id: g.id };
  }
  const [g] = await sql`
    UPDATE sales.global_section
    SET name = ${name}, project = ${proj}, html = ${input.html}, css = ${input.css},
        version = version + 1, updated_at = now()
    WHERE id = ${input.id} AND version = ${version ?? -1} RETURNING version`;
  if (!g) return CONFLICT;
  await audit(viewer, "update", "global_section", input.id, null, { name, version: g.version });
  return { kind: "ok", version: g.version, id: input.id };
}
