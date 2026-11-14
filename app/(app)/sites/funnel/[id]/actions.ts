"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  act,
  publishStep,
  saveSettings,
  type ActionState,
} from "@/lib/sites/admin-actions";
import {
  addStep,
  cloneStep,
  createFolder,
  createFunnel,
  deleteStep,
  moveStep,
  renameStep,
  setStepPath,
  saveTemplate,
} from "@/lib/sites/admin";
import {
  publishSite,
  restoreVersion,
  unpublishPage,
} from "@/lib/sites/publish";

// Server Actions are public POST endpoints: the user comes from the session,
// fields are validated here, and the service re-checks the role.

async function viewer() {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

const uuid = z.uuid();
const int = z.coerce.number().int();
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const opt = (f: FormData, k: string) => str(f, k).trim() || undefined;
const bad: ActionState = {
  error: "That wasn't possible. Reload the page and try again.",
};

// Runs `fn` with a validated form, then refreshes the funnel page.
async function run<T extends z.ZodType>(
  form: FormData,
  shape: T,
  ok: string,
  fn: (
    v: Awaited<ReturnType<typeof viewer>>,
    p: z.infer<T>,
  ) => Promise<unknown>,
): Promise<ActionState> {
  const v = await viewer();
  const p = shape.safeParse(Object.fromEntries(form));
  if (!p.success) return bad;
  const r = await act(() => fn(v, p.data), ok);
  revalidatePath("/sites/funnel/[id]", "page");
  return r;
}

const site = { siteId: uuid, version: int };
const step = { ...site, pageId: uuid };

export async function addStepAction(_: ActionState, f: FormData) {
  return run(
    f,
    z.object({
      ...site,
      name: z.string(),
      path: z.string(),
      kind: z.enum(["page", "checkout", "thank_you"]),
    }),
    "Step added.",
    (v, p) => addStep(v, p.siteId, p.version, p),
  );
}
export async function renameStepAction(_: ActionState, f: FormData) {
  return run(f, z.object({ ...step, name: z.string() }), "Renamed.", (v, p) =>
    renameStep(v, p.siteId, p.version, p.pageId, p.name),
  );
}
export async function setStepPathAction(_: ActionState, f: FormData) {
  return run(
    f,
    z.object({ ...step, path: z.string() }),
    "Path saved.",
    (v, p) => setStepPath(v, p.siteId, p.version, p.pageId, p.path),
  );
}
export async function moveStepAction(_: ActionState, f: FormData) {
  return run(f, z.object({ ...step, to: int }), "Moved.", (v, p) =>
    moveStep(v, p.siteId, p.version, p.pageId, p.to),
  );
}
export async function cloneStepAction(_: ActionState, f: FormData) {
  return run(f, z.object(step), "Cloned.", (v, p) =>
    cloneStep(v, p.siteId, p.version, p.pageId),
  );
}
export async function deleteStepAction(_: ActionState, f: FormData) {
  return run(f, z.object(step), "Deleted.", (v, p) =>
    deleteStep(v, p.siteId, p.version, p.pageId),
  );
}

// `pageVersion` is the step's own version (publish and restore check it).
export async function publishStepAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  const v = await viewer();
  const p = z
    .object({ pageId: uuid, pageVersion: int })
    .safeParse(Object.fromEntries(f));
  if (!p.success) return bad;
  const r = await publishStep(v, p.data.pageId, p.data.pageVersion);
  revalidatePath("/sites/funnel/[id]", "page");
  return r;
}
export async function publishSiteAction(_: ActionState, f: FormData) {
  return run(f, z.object({ siteId: uuid }), "All steps published.", (v, p) =>
    publishSite(v, p.siteId),
  );
}
export async function unpublishStepAction(_: ActionState, f: FormData) {
  return run(f, z.object({ pageId: uuid }), "Unpublished.", (v, p) =>
    unpublishPage(v, p.pageId),
  );
}
export async function restoreVersionAction(_: ActionState, f: FormData) {
  return run(
    f,
    z.object({ pageId: uuid, versionId: uuid, pageVersion: int }),
    "Restored and published.",
    (v, p) => restoreVersion(v, p.pageId, p.versionId, p.pageVersion),
  );
}

export async function saveTemplateAction(_: ActionState, f: FormData) {
  return run(
    f,
    z.object({ siteId: uuid, name: z.string() }),
    "Template saved.",
    (v, p) => saveTemplate(v, p.siteId, p.name),
  );
}

// Settings and SEO are two forms over one settings object; each sends its own keys.
export async function saveSettingsAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  const v = await viewer();
  const p = z
    .object({ ...site, section: z.enum(["general", "seo"]) })
    .safeParse(Object.fromEntries(f));
  if (!p.success) return bad;
  const t = (k: string) => opt(f, k);
  const on = (k: string) => f.get(k) === "on";
  const patch =
    p.data.section === "seo"
      ? {
          seo: {
            title: t("seo.title"),
            description: t("seo.description"),
            image: t("seo.image"),
            noindex: on("noindex"),
          },
        }
      : {
          favicon: t("favicon"),
          pixels: {
            meta: t("pixels.meta"),
            google: t("pixels.google"),
            linkedin: t("pixels.linkedin"),
            tiktok: t("pixels.tiktok"),
          },
          capi: on("capi"),
          chatWidget: t("chatWidget.whatsapp")
            ? { whatsapp: t("chatWidget.whatsapp")! }
            : undefined,
          paymentMode: t("paymentMode"),
          privacyUrl: t("privacyUrl"),
        };
  const r = await saveSettings(v, p.data.siteId, p.data.version, patch);
  revalidatePath("/sites/funnel/[id]", "page");
  return r;
}

// ---- the list page ----

export async function createFunnelAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  const v = await viewer();
  const p = z
    .object({
      name: z.string(),
      basePath: z.string(),
      language: z.enum(["en", "zh"]),
    })
    .safeParse(Object.fromEntries(f));
  if (!p.success) return bad;
  let id = "";
  const r = await act(async () => {
    id = (
      await createFunnel(v, {
        ...p.data,
        folderId: opt(f, "folderId"),
        templateId: opt(f, "templateId"),
      })
    ).siteId;
  });
  if (id) redirect(`/sites/funnel/${id}`);
  return r;
}

export async function createFolderAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  const v = await viewer();
  const r = await act(
    () => createFolder(v, "funnel", str(f, "name")),
    "Folder created.",
  );
  revalidatePath("/sites");
  return r;
}
