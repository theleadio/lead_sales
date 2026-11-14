"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SitesPermissionError, saveDraft, takeEditLock } from "@/lib/sites/admin";
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
  return guarded(() => publishPage(v, pageId, version));
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
