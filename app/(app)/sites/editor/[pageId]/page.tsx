import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDraft, getSite, takeEditLock } from "@/lib/sites/admin";
import { crmScheduleCached } from "@/lib/sites/crm-api";
import { listCustomValues } from "@/lib/sites/custom-values";
import { DEFAULT_THEME } from "@/lib/sites/model";
import { canEditSites, canViewSites } from "@/lib/sites/permissions";
import { parsePage } from "@/lib/sites/tree-server";
import { takeOverAction } from "../actions";
import EditorLoader from "../editor-loader";

// The editor: permission, the draft and the edit lock are settled here; the
// editor itself is a client component (editor-loader.tsx, ssr: false: the
// canvas iframe only exists in the browser).
export default async function EditorPage({ params, searchParams }: PageProps<"/sites/editor/[pageId]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canViewSites(user.role)) redirect("/home");
  const { pageId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) notFound();
  const { mode } = await searchParams;
  const v = { id: user.id, role: user.role };

  // View-only roles, and editors who chose "read-only", never take the lock or save.
  const readOnly = !canEditSites(user.role) || mode === "readonly";
  if (!readOnly) {
    const { holder } = await takeEditLock(v, pageId);
    if (holder) {
      return (
        <main className="mx-auto max-w-md p-10">
          <h1 className="text-lg font-semibold">{holder.name} is editing this step</h1>
          <p className="text-ink-muted mt-2 text-sm">
            Open it read-only, or take over (they will see a message and their next save will be refused).
          </p>
          <div className="mt-6 flex gap-3">
            <form action={takeOverAction}>
              <input type="hidden" name="pageId" value={pageId} />
              <button className="bg-action text-action-ink cursor-pointer rounded-lg px-4 py-2 text-sm font-medium">Take over</button>
            </form>
            <Link
              href={`/sites/editor/${pageId}?mode=readonly`}
              className="border-line rounded-lg border px-4 py-2 text-sm"
            >
              Open read-only
            </Link>
          </div>
        </main>
      );
    }
  }

  let draft;
  try {
    draft = await getDraft(v, pageId);
  } catch {
    notFound();
  }
  const site = await getSite(v, draft.siteId);
  if (!site) notFound();

  // A new step has an empty project; anything else must be a v2 page tree
  // (old editor data is not openable here).
  const empty = !draft.project || (typeof draft.project === "object" && Object.keys(draft.project).length === 0);
  const parsed = empty ? { ok: true as const, page: { version: 2 as const, sections: [], popups: [] } } : parsePage(draft.project);
  if (!parsed.ok) {
    return (
      <main className="mx-auto max-w-md p-10">
        <h1 className="text-lg font-semibold">This step can&apos;t be opened</h1>
        <p className="text-ink-muted mt-2 text-sm">Its saved content is not in the current format ({parsed.message}).</p>
        <Link href={`/sites/funnel/${site.id}`} className="border-line mt-6 inline-block rounded-lg border px-4 py-2 text-sm">
          Back to the funnel
        </Link>
      </main>
    );
  }
  const [values, schedule] = await Promise.all([listCustomValues(v), crmScheduleCached()]);
  const st = site.settings ?? {};

  return (
    <EditorLoader
      pageId={pageId}
      siteId={site.id}
      siteName={site.name}
      domain={site.domain}
      basePath={site.basePath}
      pageName={draft.name}
      path={draft.path}
      version={draft.version}
      siteVersion={site.version}
      page={parsed.page}
      readOnly={readOnly}
      steps={site.steps.map((x) => ({ id: x.id, name: x.name, path: x.path, kind: x.kind, livePath: x.livePath }))}
      settings={{ theme: { ...DEFAULT_THEME, ...st.theme }, seo: st.seo ?? {}, pixels: st.pixels ?? {}, capi: !!st.capi }}
      classes={schedule.kind === "ok" ? schedule.classes.map(({ code, courseName, startDate }) => ({ code, courseName, startDate })) : []}
      values={values.map(({ key, label, value, version }) => ({ key, label, value, version }))}
    />
  );
}
