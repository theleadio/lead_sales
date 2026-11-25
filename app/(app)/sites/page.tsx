import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listFolders, listSites, listTemplates } from "@/lib/sites/admin";
import { klDay, siteSummaries } from "@/lib/sites/stats";
import { canEditSites, canViewSites } from "@/lib/sites/permissions";
import { RowLink } from "../row-link";
import { Plus } from "lucide-react";
import {
  Badge,
  button,
  EmptyState,
  field,
  page,
  PageHeader,
  searchField,
  Segmented,
  table as t,
  Toolbar,
} from "../ui";
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
  const today = klDay(new Date());
  const [all, folders, templates, summary] = await Promise.all([
    listSites(user, "funnel"),
    listFolders(user, "funnel"),
    listTemplates(user, "funnel"),
    siteSummaries(user, "funnel", klDay(new Date(new Date(`${today}T00:00:00+08:00`).getTime() - 6 * 86_400_000)), today),
  ]);
  const sites = all.filter(
    (s) =>
      (!folder || s.folderId === folder) &&
      (!search || s.name.toLowerCase().includes(search)),
  );

  return (
    <section className={page}>
      <PageHeader
        title="Sites & funnels"
        lede="Your funnels, their views and opt-ins over the last 7 days."
        action={
          edit && (
            <a href="#new-funnel" className={button}>
              <Plus className="size-[18px]" aria-hidden="true" />
              New funnel
            </a>
          )
        }
      />

      <Toolbar>
        <Segmented
          label="Type"
          options={[
            { label: "Funnels", href: "/sites", current: true },
            { label: "Websites", disabled: true, title: "Coming soon" },
          ]}
        />
        <form method="get" className="contents">
          <input
            type="search"
            name="q"
            defaultValue={one("q")}
            placeholder="Search funnels"
            aria-label="Search funnels"
            className={searchField}
          />
          {folders.length > 0 && (
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
          )}
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>
        <span className="ml-auto flex gap-4 text-sm">
          <Link href="/sites/templates" className="text-ink-muted hover:text-ink">
            Templates
          </Link>
          <Link href="/sites/sections" className="text-ink-muted hover:text-ink">
            Global sections
          </Link>
        </span>
      </Toolbar>

      {sites.length === 0 ? (
        <EmptyState title={`No funnels ${search || folder ? "match" : "yet"}`} />
      ) : (
        <div className={t.wrap}>
          <table className={t.table}>
            <thead>
              <tr>
                <th className={t.th}>Name</th>
                <th className={t.th}>Folder</th>
                <th className={`${t.th} text-right`}>Steps</th>
                <th className={`${t.th} text-right`}>Views, 7 days</th>
                <th className={`${t.th} text-right`}>Opt-ins, 7 days</th>
                <th className={t.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <RowLink key={s.id} href={`/sites/funnel/${s.id}`} className={t.row}>
                  <td className={t.td}>
                    <Link
                      href={`/sites/funnel/${s.id}`}
                      className="font-medium"
                    >
                      {s.name}
                    </Link>
                    <span className={`${t.sub} break-all`}>
                      {s.live ? s.liveUrl.replace(/^https:\/\//, "") : "Not published"}
                    </span>
                  </td>
                  <td className={t.td}>{s.folderName ?? "—"}</td>
                  <td className={`${t.td} ${t.num}`}>{s.steps}</td>
                  <td className={`${t.td} ${t.num}`}>
                    {(summary.get(s.id)?.views ?? 0).toLocaleString("en-MY")}
                  </td>
                  <td className={`${t.td} ${t.num}`}>
                    {(summary.get(s.id)?.optins ?? 0).toLocaleString("en-MY")}
                  </td>
                  <td className={t.td}>
                    <Badge tone={s.live ? "green" : "grey"}>
                      {s.live ? "Live" : "Draft"}
                    </Badge>
                  </td>
                </RowLink>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <div id="new-funnel" className="mt-8 grid scroll-mt-6 gap-6 md:grid-cols-2">
          <ActionForm
            action={createFunnelAction}
            className="border-line flex flex-col gap-3 rounded-[14px] border p-4"
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
            <label className="flex flex-col gap-1 text-sm" htmlFor="nf-language">
              <span className="font-medium">Language</span>
              <select id="nf-language" name="language" className={field}>
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm" htmlFor="nf-folder">
              <span className="font-medium">Folder</span>
              <select id="nf-folder" name="folderId" className={field}>
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm" htmlFor="nf-template">
              <span className="font-medium">Start from</span>
              <select id="nf-template" name="templateId" className={field}>
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
            className="border-line flex flex-col gap-3 self-start rounded-[14px] border p-4"
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
