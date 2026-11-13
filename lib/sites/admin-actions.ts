import {
  SitesPermissionError,
  getSite,
  updateSiteSettings,
  type Result,
} from "./admin.ts";
import { siteSettingsSchema, type SiteSettings } from "./model.ts";
import { publishPage, type PublishResult } from "./publish.ts";
import type { Role } from "../auth/roles.ts";

// What the admin screens' server actions do, minus the session lookup and
// FormData parsing, so they are testable. Every one re-checks permission
// through the service it calls; a refusal shows as a message.

type Viewer = { id: string; role: Role };
export type ActionState = {
  ok?: string;
  error?: string;
  fields?: Record<string, string>;
};

// A new site's settings column starts empty; screens and saves fill the gaps.
export const withDefaults = (
  s: Partial<SiteSettings> | null,
): SiteSettings => ({
  pixels: {},
  capi: false,
  paymentMode: "test",
  seo: {},
  ...s,
});

export const CONFLICT_MESSAGE = "Changed by someone else — reload";
export const FORBIDDEN_MESSAGE = "You don't have permission to do that.";

// Runs a service call and turns its outcome into something the page can show.
export async function act(
  fn: () => Promise<Result | PublishResult | unknown>,
  ok = "Done.",
): Promise<ActionState> {
  try {
    const r = (await fn()) as { kind?: string; reasons?: string[] } | undefined;
    if (r?.kind === "conflict") return { error: CONFLICT_MESSAGE };
    if (r?.kind === "refused")
      return { error: `Not published: ${r.reasons?.join("; ")}` };
    return { ok };
  } catch (e) {
    if (e instanceof SitesPermissionError) return { error: FORBIDDEN_MESSAGE };
    const code = (e as { code?: string }).code;
    if (code === "23505")
      return { error: "That path or name is already used." };
    // Our own validation errors have plain messages; anything with a driver code is not for the screen.
    if (e instanceof Error && !code) return { error: e.message };
    console.error("sites action failed", e);
    return { error: "Something went wrong. Reload and try again." };
  }
}

export const publishStep = (v: Viewer, pageId: string, version: number) =>
  act(() => publishPage(v, pageId, version), "Published.");

// `patch` replaces whole top-level keys (pixels, seo, ...) of the current
// settings; the schema's errors come back keyed by field path.
export async function saveSettings(
  v: Viewer,
  siteId: string,
  version: number,
  patch: Record<string, unknown>,
): Promise<ActionState> {
  let site = null as Awaited<ReturnType<typeof getSite>>;
  const read = await act(async () => void (site = await getSite(v, siteId)));
  if (read.error) return read;
  if (!site) return { error: "No such site." };
  const parsed = siteSettingsSchema.safeParse({
    ...withDefaults(site.settings),
    ...patch,
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".")] ??= i.message;
    return { error: "Check the highlighted fields.", fields };
  }
  return act(
    () => updateSiteSettings(v, siteId, parsed.data, version),
    "Settings saved.",
  );
}
