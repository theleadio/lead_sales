import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listFolders, listSites, listTemplates } from "@/lib/sites/admin";
import { klDay, siteSummaries } from "@/lib/sites/stats";
import { canEditSites, canViewSites } from "@/lib/sites/permissions";
import { RowLink } from "../row-link";
import { Copy, FolderInput, FolderPlus, Plus, SquareArrowOutUpRight, Trash2, Type } from "lucide-react";
import { PUBLIC_HOST } from "@/lib/sites/host";
import {
  Badge,
  button,
  choiceCard,
  EmptyState,
  field,
  page,
  PageHeader,
  searchField,
  Segmented,
  table as t,
  Toolbar,
  ghostButton,
  menuItem,
} from "../ui";
import { CloseDialog, Dialog, Menu, MenuSeparator, OpenDialog } from "../menus";
import { ActionForm, Field, FieldError } from "./action-form";
import {
  createFolderAction,
  createFunnelAction,
  deleteSiteAction,
  duplicateSiteAction,
  moveSiteAction,
  renameSiteAction,
} from "./funnel/[id]/actions";

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
            <OpenDialog target="new-funnel" className={button}>
              <Plus className="size-[18px]" aria-hidden="true" />
              New funnel
            </OpenDialog>
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
          {folder && <input type="hidden" name="folder" value={folder} />}
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

      {(folders.length > 0 || edit) && (
        <nav aria-label="Folders" className="mt-3.5 flex flex-wrap gap-1.5 text-[13px]">
          {[{ id: "", name: "All funnels" }, ...folders].map((f) => {
            const on = f.id === folder;
            const qs = new URLSearchParams({
              ...(f.id ? { folder: f.id } : {}),
              ...(search ? { q: one("q") } : {}),
            }).toString();
            return (
              <Link
                key={f.id || "all"}
                href={`/sites${qs ? `?${qs}` : ""}`}
                aria-current={on ? "page" : undefined}
                className={`rounded-full border px-3 py-1 ${on ? "border-action bg-action text-action-ink" : "border-line text-ink-muted hover:text-ink hover:bg-surface-muted"}`}
              >
                {f.name}
              </Link>
            );
          })}
          {edit && (
            <OpenDialog
              target="new-folder"
              className="border-line text-ink-muted hover:text-ink hover:bg-surface-muted inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-3 py-1"
            >
              <FolderPlus className="size-3.5" aria-hidden="true" />
              New folder
            </OpenDialog>
          )}
        </nav>
      )}

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
                {edit && <th className={t.th}><span className="sr-only">Actions</span></th>}
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
                  {edit && (
                    <td className={`${t.td} w-px py-1.5 text-right`}>
                      <Menu label={`More actions for ${s.name}`}>
                        <Link href={`/sites/funnel/${s.id}`} role="menuitem" className={menuItem}>
                          <SquareArrowOutUpRight aria-hidden="true" /> Open
                        </Link>
                        <OpenDialog target={`rename-${s.id}`} role="menuitem" className={menuItem}>
                          <Type aria-hidden="true" /> Rename
                        </OpenDialog>
                        <OpenDialog target={`move-${s.id}`} role="menuitem" className={menuItem}>
                          <FolderInput aria-hidden="true" /> Move to folder
                        </OpenDialog>
                        <button type="submit" form={`dup-${s.id}`} role="menuitem" className={menuItem}>
                          <Copy aria-hidden="true" /> Duplicate
                        </button>
                        <MenuSeparator />
                        <button
                          type="submit"
                          form={`del-${s.id}`}
                          role="menuitem"
                          disabled={s.live}
                          title={s.live ? "Unpublish its steps first" : undefined}
                          className={`${menuItem} text-danger [&_svg]:text-danger`}
                        >
                          <Trash2 aria-hidden="true" /> {s.live ? "Delete (unpublish first)" : "Delete…"}
                        </button>
                      </Menu>
                      <ActionForm action={duplicateSiteAction} id={`dup-${s.id}`} className="text-left text-xs">
                        <input type="hidden" name="siteId" value={s.id} />
                      </ActionForm>
                      <ActionForm
                        action={deleteSiteAction}
                        id={`del-${s.id}`}
                        confirm={`Delete the funnel "${s.name}" and all its steps? This cannot be undone.`}
                        className="text-left text-xs"
                      >
                        <input type="hidden" name="siteId" value={s.id} />
                      </ActionForm>
                    </td>
                  )}
                </RowLink>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit &&
        sites.map((s) => (
          <div key={s.id}>
            <Dialog id={`rename-${s.id}`} title="Rename funnel">
              <ActionForm action={renameSiteAction} className="flex flex-col gap-3">
                <input type="hidden" name="siteId" value={s.id} />
                <Field label="Name" name="name" defaultValue={s.name} required />
                <div className="mt-1 flex justify-end gap-2">
                  <CloseDialog className={ghostButton}>Cancel</CloseDialog>
                  <button type="submit" className={button}>Save</button>
                </div>
              </ActionForm>
            </Dialog>
            <Dialog id={`move-${s.id}`} title="Move to folder" lede={s.name}>
              <ActionForm action={moveSiteAction} className="flex flex-col gap-3">
                <input type="hidden" name="siteId" value={s.id} />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Folder</span>
                  <select name="folderId" defaultValue={s.folderId ?? ""} className={field}>
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-1 flex justify-end gap-2">
                  <CloseDialog className={ghostButton}>Cancel</CloseDialog>
                  <button type="submit" className={button}>Move</button>
                </div>
              </ActionForm>
            </Dialog>
          </div>
        ))}

      {edit && (
        <>
          <Dialog id="new-funnel" title="New funnel" lede="You can change all of this later.">
            <ActionForm action={createFunnelAction} className="flex flex-col gap-3.5">
              <Field label="Name" name="name" required />
              <label className="flex flex-col gap-1 text-sm" htmlFor="nf-path">
                <span className="font-medium">Web address</span>
                <span className="flex">
                  <span className="border-line bg-surface-muted text-ink-muted rounded-l-lg border border-r-0 px-2.5 py-2 text-sm">
                    {PUBLIC_HOST}
                  </span>
                  <input
                    id="nf-path"
                    name="basePath"
                    defaultValue="/"
                    required
                    aria-describedby="nf-path-hint"
                    className={`${field} min-w-0 flex-1 rounded-l-none`}
                  />
                </span>
                <span id="nf-path-hint" className="text-ink-muted text-xs">
                  The steps live under this, e.g. /ai-workshop
                </span>
                <FieldError name="basePath" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm" htmlFor="nf-language">
                  <span className="font-medium">Language</span>
                  <select id="nf-language" name="language" className={field}>
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm" htmlFor="nf-folder">
                  <span className="font-medium">Folder</span>
                  <select id="nf-folder" name="folderId" defaultValue={folder} className={field}>
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <fieldset className="flex flex-col text-sm">
                <legend className="mb-1.5 font-medium">Start from</legend>
                <div className="grid max-h-[220px] gap-2 overflow-y-auto sm:grid-cols-2">
                  <label className={choiceCard}>
                    <input type="radio" name="templateId" value="" defaultChecked className="sr-only" />
                    <span className="font-medium">Blank</span>
                    <span className="text-ink-muted text-xs">Home, Payment Form, Thank You</span>
                  </label>
                  {templates.map((t) => (
                    <label key={t.id} className={choiceCard}>
                      <input type="radio" name="templateId" value={t.id} className="sr-only" />
                      <span className="font-medium">{t.name}</span>
                      <span className="text-ink-muted text-xs">Template</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-1 flex justify-end gap-2">
                <CloseDialog className={ghostButton}>Cancel</CloseDialog>
                <button type="submit" className={button}>
                  Create funnel
                </button>
              </div>
            </ActionForm>
          </Dialog>
          <Dialog id="new-folder" title="New folder" lede="Folders group funnels in the list.">
            <ActionForm action={createFolderAction} className="flex flex-col gap-3">
              <Field label="Name" name="name" required />
              <div className="mt-1 flex justify-end gap-2">
                <CloseDialog className={ghostButton}>Cancel</CloseDialog>
                <button type="submit" className={button}>
                  Create folder
                </button>
              </div>
            </ActionForm>
          </Dialog>
        </>
      )}
    </section>
  );
}
