import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withDefaults } from "@/lib/sites/admin-actions";
import { getSite } from "@/lib/sites/admin";
import { canEditSites, canViewSites } from "@/lib/sites/permissions";
import { listVersions } from "@/lib/sites/publish";
import { klDay, siteStats } from "@/lib/sites/stats";
import { button, field, myt } from "../../../ui";
import { ActionForm, Field } from "../../action-form";
import {
  addStepAction,
  cloneStepAction,
  deleteStepAction,
  moveStepAction,
  publishSiteAction,
  publishStepAction,
  renameStepAction,
  restoreVersionAction,
  saveSettingsAction,
  saveTemplateAction,
  setStepPathAction,
  unpublishStepAction,
} from "./actions";

const TABS = [
  ["steps", "Steps"],
  ["stats", "Stats"],
  ["settings", "Settings"],
  ["seo", "SEO"],
] as const;
const ghost =
  "border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const myr = (n: number) =>
  n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// One funnel: its steps (list left, panel right), stats, settings and SEO.
export default async function FunnelPage({
  params,
  searchParams,
}: PageProps<"/sites/funnel/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canViewSites(user.role)) redirect("/home");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const site = await getSite(user, id);
  if (!site || site.kind !== "funnel") notFound();
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) ?? "";
  const tab = TABS.find(([t]) => t === one("tab"))?.[0] ?? "steps";
  const edit = canEditSites(user.role);
  const href = (t: string, extra = "") =>
    `/sites/funnel/${id}?tab=${t}${extra}`;

  return (
    <section className="max-w-6xl">
      <Link href="/sites" className="text-ink-muted text-sm underline">
        Sites &amp; funnels
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{site.name}</h1>
      <p className="text-ink-muted text-sm">
        {site.domain}
        {site.basePath === "/" ? "" : site.basePath} ·{" "}
        {site.language === "zh" ? "中文" : "English"}
      </p>
      <nav
        className="border-line mt-4 flex gap-4 border-b text-sm"
        aria-label="Funnel sections"
      >
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={href(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`px-1 pb-2 ${tab === t ? "border-action border-b-2 font-medium" : "text-ink-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "steps" && (
          <Steps site={site} user={user} edit={edit} selected={one("step")} />
        )}
        {tab === "stats" && (
          <Stats
            siteId={id}
            user={user}
            from={one("from")}
            to={one("to")}
            tabHref={href("stats")}
          />
        )}
        {tab === "settings" && <General site={site} edit={edit} />}
        {tab === "seo" && <Seo site={site} edit={edit} />}
      </div>
    </section>
  );
}

type Site = NonNullable<Awaited<ReturnType<typeof getSite>>>;
type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function Steps({
  site,
  user,
  edit,
  selected,
}: {
  site: Site;
  user: User;
  edit: boolean;
  selected: string;
}) {
  const history = new Map(
    await Promise.all(
      site.steps.map(
        async (s) => [s.id, await listVersions(user, s.id)] as const,
      ),
    ),
  );
  const live = (id: string) =>
    history.get(id)!.some((v) => v.status === "published");
  const cur = site.steps.find((s) => s.id === selected) ?? site.steps[0];
  const ids = { siteId: site.id, version: site.version };
  const hidden = (o: Record<string, string | number>) =>
    Object.entries(o).map(([k, v]) => (
      <input key={k} type="hidden" name={k} value={v} />
    ));

  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <div>
        <ol className="border-line divide-y rounded-2xl border">
          {site.steps.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sites/funnel/${site.id}?tab=steps&step=${s.id}`}
                aria-current={s.id === cur?.id ? "true" : undefined}
                className={`flex items-center justify-between gap-2 px-4 py-3 text-sm ${s.id === cur?.id ? "bg-surface-muted font-medium" : ""}`}
              >
                <span>
                  {s.position}. {s.name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${live(s.id) ? "bg-lead-blue/50" : "bg-surface-muted text-ink-muted"}`}
                >
                  {live(s.id) ? "Live" : "Draft"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {edit && (
          <>
            <ActionForm action={publishSiteAction} className="mt-3">
              {hidden({ siteId: site.id })}
              <button type="submit" className={button}>
                Publish all steps
              </button>
            </ActionForm>
            <ActionForm
              action={addStepAction}
              className="border-line mt-4 flex flex-col gap-2 rounded-2xl border p-4"
            >
              <h2 className="text-sm font-semibold">Add a step</h2>
              {hidden(ids)}
              <Field label="Name" name="name" required />
              <Field
                label="Path"
                name="path"
                defaultValue={site.basePath === "/" ? "/" : `${site.basePath}/`}
                required
              />
              <select name="kind" aria-label="Step type" className={field}>
                <option value="page">Page</option>
                <option value="checkout">Checkout</option>
                <option value="thank_you">Thank you</option>
              </select>
              <button type="submit" className={`${ghost} self-start`}>
                Add step
              </button>
            </ActionForm>
          </>
        )}
      </div>

      {cur ? (
        <div className="border-line rounded-2xl border p-5" key={cur.id}>
          <h2 className="text-lg font-semibold">{cur.name}</h2>
          {!edit && (
            <p className="text-ink-muted text-sm">
              Path: <code>{cur.path}</code>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {edit && (
              <Link href={`/sites/editor/${cur.id}`} className={button}>
                Edit
              </Link>
            )}
            <Link
              href={`/sites/preview/${cur.id}`}
              target="_blank"
              className={ghost}
            >
              Preview
            </Link>
            {live(cur.id) && (
              <a
                href={`https://${site.domain}${cur.path}`}
                target="_blank"
                rel="noopener"
                className={ghost}
              >
                Open live
              </a>
            )}
          </div>

          {edit && (
            <div className="mt-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm
                  action={
                    live(cur.id) ? unpublishStepAction : publishStepAction
                  }
                >
                  {hidden({ pageId: cur.id, pageVersion: cur.version })}
                  <button
                    type="submit"
                    className={live(cur.id) ? ghost : button}
                  >
                    {live(cur.id) ? "Unpublish" : "Publish"}
                  </button>
                </ActionForm>
                {live(cur.id) && (
                  <ActionForm action={publishStepAction}>
                    {hidden({ pageId: cur.id, pageVersion: cur.version })}
                    <button type="submit" className={ghost}>
                      Publish latest draft
                    </button>
                  </ActionForm>
                )}
                <ActionForm action={moveStepAction}>
                  {hidden({ ...ids, pageId: cur.id, to: cur.position - 1 })}
                  <button
                    type="submit"
                    disabled={cur.position <= 1}
                    className={ghost}
                  >
                    Move up
                  </button>
                </ActionForm>
                <ActionForm action={moveStepAction}>
                  {hidden({ ...ids, pageId: cur.id, to: cur.position + 1 })}
                  <button
                    type="submit"
                    disabled={cur.position >= site.steps.length}
                    className={ghost}
                  >
                    Move down
                  </button>
                </ActionForm>
                <ActionForm action={cloneStepAction}>
                  {hidden({ ...ids, pageId: cur.id })}
                  <button type="submit" className={ghost}>
                    Clone
                  </button>
                </ActionForm>
                <ActionForm
                  action={deleteStepAction}
                  confirm={`Delete the step "${cur.name}"? This cannot be undone.`}
                >
                  {hidden({ ...ids, pageId: cur.id })}
                  <button type="submit" className={`${ghost} text-danger`}>
                    Delete
                  </button>
                </ActionForm>
              </div>
              <ActionForm
                action={setStepPathAction}
                className="flex items-end gap-2"
              >
                {hidden({ ...ids, pageId: cur.id })}
                <Field
                  label="Path"
                  name="path"
                  defaultValue={cur.path}
                  required
                />
                <button type="submit" className={ghost}>
                  Save path
                </button>
              </ActionForm>
              {live(cur.id) && cur.livePath !== cur.path && (
                <p role="status" className="text-sm">
                  Live at <code>{cur.livePath ?? "—"}</code> until republished.
                  Republish to apply.
                </p>
              )}
              <ActionForm
                action={renameStepAction}
                className="flex items-end gap-2"
              >
                {hidden({ ...ids, pageId: cur.id })}
                <Field
                  label="Rename step"
                  name="name"
                  defaultValue={cur.name}
                  required
                />
                <button type="submit" className={ghost}>
                  Rename
                </button>
              </ActionForm>
            </div>
          )}

          <h3 className="mt-6 text-sm font-semibold">History</h3>
          {history.get(cur.id)!.length === 0 ? (
            <p className="text-ink-muted text-sm">Not published yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {history.get(cur.id)!.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span>
                    {v.publishedAt ? myt(v.publishedAt) : "—"}
                    {v.publishedBy ? ` · ${v.publishedBy}` : ""}
                    <span className="text-ink-muted">
                      {" "}
                      · {v.status === "published" ? "live" : "earlier version"}
                    </span>
                  </span>
                  {edit && v.status !== "published" && (
                    <ActionForm
                      action={restoreVersionAction}
                      confirm="Restore this version and publish it now?"
                    >
                      {hidden({
                        pageId: cur.id,
                        versionId: v.id,
                        pageVersion: cur.version,
                      })}
                      <button type="submit" className={ghost}>
                        Restore
                      </button>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-ink-muted text-sm">This funnel has no steps yet.</p>
      )}
    </div>
  );
}

// Last 30 KL days by default (today included).
async function Stats({
  siteId,
  user,
  from,
  to,
  tabHref,
}: {
  siteId: string;
  user: User;
  from: string;
  to: string;
  tabHref: string;
}) {
  const today = klDay(new Date());
  const to2 = DAY.test(to) ? to : today;
  const from2 = DAY.test(from)
    ? from
    : klDay(
        new Date(new Date(`${to2}T00:00:00+08:00`).getTime() - 29 * 86_400_000),
      );
  const rows = await siteStats(user, siteId, from2, to2);
  return (
    <div>
      <form
        method="get"
        action={tabHref.split("?")[0]}
        className="flex flex-wrap items-end gap-3 text-sm"
      >
        <input type="hidden" name="tab" value="stats" />
        <label className="flex flex-col gap-1">
          <span className="font-medium">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from2}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">To</span>
          <input type="date" name="to" defaultValue={to2} className={field} />
        </label>
        <button type="submit" className={ghost}>
          Show
        </button>
      </form>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-ink-muted">
            <tr>
              {[
                "Step",
                "Views",
                "Uniques",
                "Opt-ins",
                "Opt-in rate",
                "Orders",
                "Revenue (MYR)",
                "Avg order",
                "Earnings per view",
              ].map((h) => (
                <th key={h} className="py-2 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pageId} className="border-line border-t">
                <td className="py-2 pr-4 font-medium">{r.name}</td>
                <td className="py-2 pr-4">{r.views}</td>
                <td className="py-2 pr-4">{r.uniques}</td>
                <td className="py-2 pr-4">{r.optins}</td>
                <td className="py-2 pr-4">{(r.optinRate * 100).toFixed(1)}%</td>
                <td className="py-2 pr-4">{r.orders}</td>
                <td className="py-2 pr-4">{myr(r.revenueMyr)}</td>
                <td className="py-2 pr-4">{myr(r.avgOrderMyr)}</td>
                <td className="py-2">{myr(r.earningsPerView)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Check({
  name,
  label,
  on,
}: {
  name: string;
  label: string;
  on: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={on} /> {label}
    </label>
  );
}

function General({ site, edit }: { site: Site; edit: boolean }) {
  const s = withDefaults(site.settings);
  return (
    <div className="grid max-w-2xl gap-6">
      <ActionForm action={saveSettingsAction} className="flex flex-col gap-3">
        <input type="hidden" name="siteId" value={site.id} />
        <input type="hidden" name="version" value={site.version} />
        <input type="hidden" name="section" value="general" />
        <fieldset disabled={!edit} className="flex flex-col gap-3">
          <Field
            label="Favicon URL"
            name="favicon"
            defaultValue={s.favicon}
            hint="https:// only"
          />
          <Field
            label="Meta pixel ID"
            name="pixels.meta"
            defaultValue={s.pixels.meta}
          />
          <Field
            label="Google tag ID"
            name="pixels.google"
            defaultValue={s.pixels.google}
            hint="G-… or AW-…"
          />
          <Field
            label="LinkedIn partner ID"
            name="pixels.linkedin"
            defaultValue={s.pixels.linkedin}
          />
          <Field
            label="TikTok pixel ID"
            name="pixels.tiktok"
            defaultValue={s.pixels.tiktok}
          />
          <Check
            name="capi"
            label="Send server-side events to Meta (CAPI)"
            on={s.capi}
          />
          <Field
            label="Chat widget WhatsApp number"
            name="chatWidget.whatsapp"
            defaultValue={s.chatWidget?.whatsapp}
            hint="Digits, e.g. 60123456789"
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Payment mode</span>
            <select
              name="paymentMode"
              defaultValue={s.paymentMode}
              className={field}
            >
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </label>
          <Field
            label="Privacy policy URL"
            name="privacyUrl"
            defaultValue={s.privacyUrl}
            hint="https:// only"
          />
        </fieldset>
        {edit && (
          <button type="submit" className={`${button} self-start`}>
            Save settings
          </button>
        )}
      </ActionForm>
      {edit && (
        <ActionForm
          action={saveTemplateAction}
          className="border-line flex flex-col gap-2 rounded-2xl border p-4"
        >
          <h2 className="text-sm font-semibold">Save as template</h2>
          <input type="hidden" name="siteId" value={site.id} />
          <Field label="Template name" name="name" required />
          <button type="submit" className={`${ghost} self-start`}>
            Save template
          </button>
        </ActionForm>
      )}
    </div>
  );
}

function Seo({ site, edit }: { site: Site; edit: boolean }) {
  const s = withDefaults(site.settings).seo;
  return (
    <ActionForm
      action={saveSettingsAction}
      className="flex max-w-2xl flex-col gap-3"
    >
      <input type="hidden" name="siteId" value={site.id} />
      <input type="hidden" name="version" value={site.version} />
      <input type="hidden" name="section" value="seo" />
      <fieldset disabled={!edit} className="flex flex-col gap-3">
        <Field label="Title" name="seo.title" defaultValue={s.title} />
        <Field
          label="Description"
          name="seo.description"
          defaultValue={s.description}
        />
        <Field
          label="Share image URL"
          name="seo.image"
          defaultValue={s.image}
          hint="https:// only"
        />
        <Check
          name="noindex"
          label="Hide from search engines (noindex)"
          on={!!s.noindex}
        />
      </fieldset>
      {edit && (
        <button type="submit" className={`${button} self-start`}>
          Save SEO
        </button>
      )}
    </ActionForm>
  );
}
