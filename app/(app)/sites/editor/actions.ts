"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SitesPermissionError, addStep, getDraft, getSite, saveDraft, takeEditLock } from "@/lib/sites/admin";
import { CONFLICT_MESSAGE, saveSettings } from "@/lib/sites/admin-actions";
import { listCustomValues, saveCustomValue } from "@/lib/sites/custom-values";
import { themeSchema } from "@/lib/sites/model";
import { crmSchedule } from "@/lib/sites/crm-api";
import { canViewSites } from "@/lib/sites/permissions";
import { publishPage } from "@/lib/sites/publish";

// The editor's server actions. Public POST endpoints: the user comes from the
// session, input is validated here, and each service re-checks the role.

async function viewer() {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

const uuid = z.uuid();
const draftShape = z.object({ project: z.unknown() });
const FORBIDDEN = "You don't have permission to do that.";
const BAD = "That wasn't possible. Reload the page and try again.";

async function guarded<T>(fn: () => Promise<T>): Promise<T | { kind: "error"; message: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SitesPermissionError) return { kind: "error", message: FORBIDDEN };
    if (e instanceof z.ZodError) return { kind: "error", message: e.issues[0]?.message ?? BAD };
    // Our own validation errors (e.g. "too large") have plain messages; driver errors don't.
    if (e instanceof Error && !(e as { code?: string }).code) return { kind: "error", message: e.message };
    console.error("editor action failed", e);
    return { kind: "error", message: "Something went wrong. Reload and try again." };
  }
}

export async function saveDraftAction(pageId: string, draft: unknown, version: number) {
  const v = await viewer();
  const d = draftShape.safeParse(draft);
  if (!uuid.safeParse(pageId).success || !d.success || !Number.isInteger(version)) return { kind: "error" as const, message: BAD };
  return guarded(() => saveDraft(v, pageId, d.data, version));
}

export async function publishAction(pageId: string, version: number) {
  const v = await viewer();
  if (!uuid.safeParse(pageId).success || !Number.isInteger(version)) return { kind: "error" as const, message: BAD };
  // A successful publish bumps the page version; hand the new one back so the editor's next save is not a conflict.
  return guarded(async () => {
    const r = await publishPage(v, pageId, version);
    return r.kind === "ok" ? { ...r, version: (await getDraft(v, pageId)).version } : r;
  });
}

// Called every minute: keeps the lock fresh and says who took over, if anyone.
export async function heartbeatAction(pageId: string) {
  const v = await viewer();
  if (!uuid.safeParse(pageId).success) return { holder: null };
  const r = await guarded(() => takeEditLock(v, pageId));
  return "holder" in r ? { holder: r.holder?.name ?? null } : { holder: null };
}

export async function takeOverAction(formData: FormData) {
  const v = await viewer();
  const id = String(formData.get("pageId") ?? "");
  if (!uuid.safeParse(id).success) redirect("/sites");
  await takeEditLock(v, id, { force: true });
  redirect(`/sites/editor/${id}`);
}

export async function listClassesAction() {
  const u = await viewer();
  if (!canViewSites(u.role)) return [];
  const r = await crmSchedule();
  return r.kind === "ok" ? r.classes : [];
}

// ---- custom values (flyout) ----

export type ValueRow = { key: string; label: string; value: string; version: number };

export async function listValuesAction(): Promise<ValueRow[]> {
  const v = await viewer();
  const r = await guarded(() => listCustomValues(v));
  return Array.isArray(r) ? r.map(({ key, label, value, version }) => ({ key, label, value, version })) : [];
}

export async function saveValueAction(input: { key: string; label: string; value: string }, version: number | null) {
  const v = await viewer();
  const i = z.object({ key: z.string().max(60), label: z.string().max(200), value: z.string().max(2000) }).safeParse(input);
  if (!i.success || (version !== null && !Number.isInteger(version))) return { kind: "error" as const, message: BAD };
  return guarded(() => saveCustomValue(v, i.data, version));
}

// ---- site settings (Typography, Background, SEO, Tracking flyouts) ----

const settingsPatch = z
  .object({
    theme: themeSchema,
    seo: z.object({ title: z.string().optional(), description: z.string().optional(), image: z.string().optional(), noindex: z.boolean().optional() }),
    pixels: z.object({ meta: z.string().optional(), google: z.string().optional(), linkedin: z.string().optional(), tiktok: z.string().optional() }),
    capi: z.boolean(),
  })
  .partial()
  .strict();

// Reuses the funnel settings save (version-checked, audited, purges live pages).
// A patch replaces whole top-level keys. Returns the site's new version.
export async function saveSiteSettingsAction(siteId: string, version: number, patch: unknown) {
  const v = await viewer();
  const p = settingsPatch.safeParse(patch);
  if (!uuid.safeParse(siteId).success || !Number.isInteger(version) || !p.success) return { kind: "error" as const, message: BAD };
  const r = await guarded(async () => {
    const res = await saveSettings(v, siteId, version, p.data);
    if (res.error === CONFLICT_MESSAGE) return { kind: "conflict" as const };
    if (res.error) return { kind: "error" as const, message: res.error, fields: res.fields };
    const site = await getSite(v, siteId);
    return { kind: "ok" as const, version: site?.version ?? version };
  });
  return r;
}

// ---- steps (Pages flyout) ----

export async function addStepAction(siteId: string, version: number, input: { name: string; path: string; kind: "page" | "checkout" | "thank_you" }) {
  const v = await viewer();
  const i = z.object({ name: z.string().max(120), path: z.string().max(200), kind: z.enum(["page", "checkout", "thank_you"]) }).safeParse(input);
  if (!uuid.safeParse(siteId).success || !Number.isInteger(version) || !i.success) return { kind: "error" as const, message: BAD };
  return guarded(async () => {
    const r = await addStep(v, siteId, version, i.data);
    if (r.kind === "conflict") return { kind: "conflict" as const };
    const site = await getSite(v, siteId);
    return {
      kind: "ok" as const,
      version: r.version,
      steps: (site?.steps ?? []).map((s) => ({ id: s.id, name: s.name, path: s.path, kind: s.kind, livePath: s.livePath })),
    };
  });
}
