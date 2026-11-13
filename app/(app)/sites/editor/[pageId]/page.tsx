import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDraft, getSite, listGlobalSections, listSectionTemplates, takeEditLock } from "@/lib/sites/admin";
import { crmSchedule } from "@/lib/sites/crm-api";
import { canEditSites, canViewSites } from "@/lib/sites/permissions";
import { takeOverAction } from "../actions";
import EditorLoader from "../editor-loader";

// The editor: permission, the draft and the edit lock are settled here; the
// canvas itself is a client component (editor-loader.tsx, ssr: false).
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
  const [sections, templates, classes] = await Promise.all([
    listGlobalSections(v),
    listSectionTemplates(v),
    crmSchedule().then((r) => (r.kind === "ok" ? r.classes : [])),
  ]);

  return (
    <EditorLoader
      pageId={pageId}
      siteId={site.id}
      siteName={site.name}
      pageName={draft.name}
      path={draft.path}
      version={draft.version}
      project={draft.project}
      html={draft.html}
      css={draft.css}
      readOnly={readOnly}
      steps={site.steps.map((s) => ({ id: s.id, name: s.name, path: s.path, kind: s.kind }))}
      sections={sections.map((s) => ({ id: s.id, name: s.name, html: s.html, css: s.css }))}
      templates={templates}
      classes={classes}
    />
  );
}
