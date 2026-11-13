import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listFolders, listSites, listTemplates } from "@/lib/sites/admin";
import { canEditSites, canViewSites } from "@/lib/sites/permissions";
import { button, field, myt } from "../ui";
import { ActionForm, Field } from "./action-form";
import { createFolderAction, createFunnelAction } from "./funnel/[id]/actions";

// Sites & funnels: the funnel list, with folders and search. Websites come in
// phase 2, so that tab is shown but off.
export default async function SitesPage({ searchParams }: PageProps<"/sites">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canViewSites(user.role)) redirect("/home");
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) ?? "";
  const search = one("q").trim().toLowerCase();
  const folder = one("folder");
  const edit = canEditSites(user.role);
  const [all, folders, templates] = await Promise.all([
    listSites(user, "funnel"),
    listFolders(user, "funnel"),
    listTemplates(user, "funnel"),
  ]);
  const sites = all.filter(
    (s) =>
      (!folder || s.folderId === folder) &&
      (!search || s.name.toLowerCase().includes(search)),
  );

  return (
    <section className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Sites &amp; funnels</h1>
      <nav
        className="border-line mt-4 flex gap-4 border-b text-sm"
        aria-label="Site type"
      >
        <span className="border-action border-b-2 px-1 pb-2 font-medium">
          Funnels
        </span>
        <span className="text-ink-muted px-1 pb-2" aria-disabled="true">
          Websites{" "}
          <span className="bg-surface-muted ml-1 rounded-full px-2 py-0.5 text-xs">
            Coming soon
          </span>
        </span>
        <Link
          href="/sites/templates"
          className="text-ink-muted ml-auto px-1 pb-2 underline"
        >
          Templates
        </Link>
        <Link
          href="/sites/sections"
          className="text-ink-muted px-1 pb-2 underline"
        >
          Global sections
        </Link>
      </nav>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={one("q")}
          placeholder="Search funnels"
          aria-label="Search funnels"
          className={field}
        />
        <select
          name="folder"
          defaultValue={folder}
          aria-label="Folder"
          className={field}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-2 text-sm"
        >
          Filter
        </button>
      </form>

      {sites.length === 0 ? (
        <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
          <p className="font-medium">
            No funnels {search || folder ? "match" : "yet"}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Folder</th>
                <th className="py-2 pr-4 font-medium">Steps</th>
                <th className="py-2 pr-4 font-medium">Updated</th>
                <th className="py-2 font-medium">Live URL</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} className="border-line border-t">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/sites/funnel/${s.id}`}
                      className="font-medium underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{s.folderName ?? "—"}</td>
                  <td className="py-2 pr-4">{s.steps}</td>
                  <td className="py-2 pr-4">{myt(s.updatedAt)}</td>
                  <td className="py-2">{s.liveUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <ActionForm
            action={createFunnelAction}
            className="border-line flex flex-col gap-3 rounded-2xl border p-4"
          >
            <h2 className="font-semibold">New funnel</h2>
            <Field label="Name" name="name" required />
            <Field
              label="Base path"
              name="basePath"
              defaultValue="/"
              hint="Steps live under this path, e.g. /ai-workshop"
              required
            />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Language</span>
              <select name="language" className={field}>
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Folder</span>
              <select name="folderId" className={field}>
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Start from</span>
              <select name="templateId" className={field}>
                <option value="">Blank (Home, Payment Form, Thank You)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    Template: {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${button} self-start`}>
              Create funnel
            </button>
          </ActionForm>
          <ActionForm
            action={createFolderAction}
            className="border-line flex flex-col gap-3 self-start rounded-2xl border p-4"
          >
            <h2 className="font-semibold">New folder</h2>
            <Field label="Name" name="name" required />
            <button type="submit" className={`${button} self-start`}>
              Create folder
            </button>
          </ActionForm>
        </div>
      )}
    </section>
  );
}
