import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Copy,
  EyeOff,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Type,
  CloudUpload,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withDefaults } from "@/lib/sites/admin-actions";
import { getSite } from "@/lib/sites/admin";
import { canEditSites, canViewSites } from "@/lib/sites/permissions";
import { listVersions } from "@/lib/sites/publish";
import { klDay, siteStats } from "@/lib/sites/stats";
import {
  Badge,
  button,
  buttonSm,
  choiceCard,
  field,
  ghostButton,
  ghostSm,
  menuItem,
  myt,
  Segmented,
  StatTile,
  switchInput,
  table as t,
  tiles,
} from "../../../ui";
import { CloseDialog, Dialog, Menu, MenuSeparator, OpenDialog } from "../../../menus";
import { ActionForm, Field } from "../../action-form";
import { SeoForm } from "./seo-form";
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
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const myr = (n: number) =>
  n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const STEP_KIND: Record<string, string> = {
  page: "Page",
  checkout: "Checkout",
  thank_you: "Thank you",
};

// One funnel: its steps (list left, panel right), stats, settings and SEO.
// The header (name, status, Preview and Publish funnel) is shared by all tabs.
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
  const liveSteps = site.steps.filter((s) => s.live).length;
  const first = site.steps[0];

  return (
    <section className="max-w-[1040px]">
      <Link
        href="/sites"
        className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Sites &amp; funnels
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[min(100%,280px)] flex-1">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-[-0.02em]">
            {site.name}
            <Badge tone={liveSteps ? "green" : "grey"}>
              {liveSteps ? "Live" : "Draft"}
            </Badge>
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            {site.domain}
            {site.basePath === "/" ? "" : site.basePath} ·{" "}
            {site.language === "zh" ? "中文" : "English"} ·{" "}
            {site.steps.length} {site.steps.length === 1 ? "step" : "steps"}
            {liveSteps === 0
              ? ", none live yet"
              : liveSteps < site.steps.length
                ? `, ${liveSteps} live`
                : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {first && (
            <Link
              href={`/sites/preview/${first.id}`}
              target="_blank"
              className={ghostButton}
            >
              Preview funnel
            </Link>
          )}
          {edit && site.steps.length > 0 && (
            <ActionForm
              action={publishSiteAction}
              confirm={`Publish all ${site.steps.length} steps? Visitors will see the latest version of every step.`}
              className="flex max-w-xs flex-col items-end text-right"
            >
              <input type="hidden" name="siteId" value={site.id} />
              <button type="submit" className={button}>
                <CloudUpload className="size-[18px]" aria-hidden="true" />
                Publish funnel
              </button>
            </ActionForm>
          )}
        </div>
      </div>
      <nav
        className="border-line mt-5 flex gap-5 overflow-x-auto border-b text-sm"
        aria-label="Funnel sections"
      >
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={href(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px px-0.5 pb-2.5 whitespace-nowrap ${tab === t ? "border-action border-b-2 font-medium" : "text-ink-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        {tab === "steps" && (
          <Steps site={site} user={user} edit={edit} selected={one("step")} />
        )}
        {tab === "stats" && (
          <Stats
            siteId={id}
            user={user}
            range={one("range")}
            from={one("from")}
            to={one("to")}
            tabHref={href("stats")}
          />
        )}
        {tab === "settings" && <General site={site} edit={edit} />}
        {tab === "seo" && (
          <SeoForm
            action={saveSettingsAction}
            siteId={site.id}
            version={site.version}
            url={`https://${site.domain}${first && first.path !== "/" ? first.path : ""}`}
            fallbackTitle={site.name}
            initial={(() => {
              const s = withDefaults(site.settings).seo;
              return {
                title: s.title ?? "",
                description: s.description ?? "",
                image: s.image ?? "",
                noindex: !!s.noindex,
              };
            })()}
            edit={edit}
          />
        )}
      </div>
    </section>
  );
}

type Site = NonNullable<Awaited<ReturnType<typeof getSite>>>;
type Step = Site["steps"][number];
type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const hidden = (o: Record<string, string | number>) =>
  Object.entries(o).map(([k, v]) => (
    <input key={k} type="hidden" name={k} value={v} />
  ));

function StepBadge({ s }: { s: Step }) {
  if (!s.live) return <Badge tone="grey">Draft</Badge>;
  if (s.changed || s.livePath !== s.path) return <Badge tone="amber">Edited</Badge>;
  return <Badge tone="green">Live</Badge>;
}

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
  const cur = site.steps.find((s) => s.id === selected) ?? site.steps[0];
  const history = cur ? await listVersions(user, cur.id) : [];
  const ids = { siteId: site.id, version: site.version };
  const stepForm = cur ? { ...ids, pageId: cur.id } : ids;
  const f = (name: string) => `${name}-${cur?.id}`;
  const pending = cur && cur.live && (cur.changed || cur.livePath !== cur.path);
  const addr = (path: string) => `${site.domain}${path === "/" ? "/" : path}`;

  return (
    <div className="grid items-start gap-5 md:grid-cols-[290px_minmax(0,1fr)]">
      <div>
        <div className="border-line overflow-hidden rounded-[14px] border">
          <ol>
            {site.steps.map((s) => {
              const on = s.id === cur?.id;
              return (
                <li key={s.id} className="border-line border-t first:border-t-0">
                  <Link
                    href={`/sites/funnel/${site.id}?tab=steps&step=${s.id}`}
                    aria-current={on ? "true" : undefined}
                    className={`flex items-center gap-3 px-3.5 py-3 text-sm ${on ? "bg-surface-muted shadow-[inset_3px_0_0_var(--action)]" : "hover:bg-hover-row"}`}
                  >
                    <span
                      className={`grid size-[26px] shrink-0 place-items-center rounded-full border text-xs font-semibold ${on ? "border-action bg-action text-action-ink" : "border-line bg-surface"}`}
                    >
                      {s.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${on ? "font-medium" : ""}`}>
                        {s.name}
                      </span>
                      <span className="text-ink-muted block truncate text-xs">
                        {s.path}
                      </span>
                    </span>
                    <StepBadge s={s} />
                  </Link>
                </li>
              );
            })}
          </ol>
          {edit && (
            <OpenDialog
              target="add-step"
              className="border-line text-ink-muted hover:bg-hover-row hover:text-ink flex w-full cursor-pointer items-center gap-2 border-t border-dashed px-3.5 py-3 text-sm"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add step
            </OpenDialog>
          )}
        </div>
        <p className="text-ink-muted mx-1 mt-2.5 text-xs">
          Visitors go through the steps in this order.
          {edit && " Use ⋯ on a step to move it up or down."}
        </p>
        {edit && (
          <Dialog id="add-step" title="Add a step" lede="It's added at the end. You can move it after.">
            <ActionForm action={addStepAction} className="flex flex-col gap-3">
              {hidden(ids)}
              <Field label="Name" name="name" required />
              <Field
                label="Path"
                name="path"
                defaultValue={site.basePath === "/" ? "/" : `${site.basePath}/`}
                hint={`The web address after ${site.domain}, e.g. ${site.basePath === "/" ? "" : site.basePath}/offer`}
                required
              />
              <fieldset className="flex flex-col gap-1.5 text-sm">
                <legend className="mb-1.5 font-medium">Type</legend>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(STEP_KIND).map(([k, label], i) => (
                    <label key={k} className={choiceCard}>
                      <input
                        type="radio"
                        name="kind"
                        value={k}
                        defaultChecked={i === 0}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-2 flex justify-end gap-2">
                <CloseDialog className={ghostButton}>Cancel</CloseDialog>
                <button type="submit" className={button}>
                  Add step
                </button>
              </div>
            </ActionForm>
          </Dialog>
        )}
      </div>

      {cur ? (
        <div className="border-line rounded-[14px] border p-5 sm:p-[22px]" key={cur.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ink-muted text-xs">
                Step {cur.position} of {site.steps.length} · {STEP_KIND[cur.kind] ?? cur.kind}
              </p>
              <h2 className="mt-0.5 text-xl font-semibold tracking-[-0.01em]">{cur.name}</h2>
              <p className="text-ink-muted mt-0.5 text-sm break-all">
                {site.domain}
                <span className="text-ink font-medium">{cur.path}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {edit && (
                <Link href={`/sites/editor/${cur.id}`} className={button}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit page
                </Link>
              )}
              <Link href={`/sites/preview/${cur.id}`} target="_blank" className={ghostButton}>
                Preview
              </Link>
              {edit && (
                <Menu label="More actions for this step">
                  <OpenDialog target={f("rename")} role="menuitem" className={menuItem}>
                    <Type aria-hidden="true" /> Rename
                  </OpenDialog>
                  <OpenDialog target={f("path")} role="menuitem" className={menuItem}>
                    <Link2 aria-hidden="true" /> Change web address
                  </OpenDialog>
                  <button type="submit" form={f("clone")} role="menuitem" className={menuItem}>
                    <Copy aria-hidden="true" /> Duplicate step
                  </button>
                  <MenuSeparator />
                  <button
                    type="submit"
                    form={f("up")}
                    role="menuitem"
                    disabled={cur.position <= 1}
                    className={menuItem}
                  >
                    <ArrowUp aria-hidden="true" /> Move up
                  </button>
                  <button
                    type="submit"
                    form={f("down")}
                    role="menuitem"
                    disabled={cur.position >= site.steps.length}
                    className={menuItem}
                  >
                    <ArrowDown aria-hidden="true" /> Move down
                  </button>
                  <MenuSeparator />
                  {cur.live && (
                    <>
                      <button type="submit" form={f("publish")} role="menuitem" className={menuItem}>
                        <RotateCcw aria-hidden="true" /> Publish again
                      </button>
                      <button type="submit" form={f("unpublish")} role="menuitem" className={menuItem}>
                        <EyeOff aria-hidden="true" /> Unpublish
                      </button>
                      <MenuSeparator />
                    </>
                  )}
                  <button
                    type="submit"
                    form={f("delete")}
                    role="menuitem"
                    className={`${menuItem} text-danger [&_svg]:text-danger`}
                  >
                    <Trash2 aria-hidden="true" /> Delete step…
                  </button>
                </Menu>
              )}
            </div>
          </div>

          {/* What visitors see now, and the one thing to do about it. */}
          {!cur.live ? (
            <StatusBox tone="warn" title="Not live yet." text="Visitors can't see this step until you publish it.">
              {edit && (
                <ActionForm action={publishStepAction} className="flex flex-col items-end text-right">
                  {hidden({ pageId: cur.id, pageVersion: cur.version })}
                  <button type="submit" className={buttonSm}>
                    Publish this step
                  </button>
                </ActionForm>
              )}
            </StatusBox>
          ) : pending ? (
            <StatusBox
              tone="info"
              title="You have changes that aren't live."
              text={
                cur.livePath !== cur.path
                  ? `Visitors still see this step at ${addr(cur.livePath ?? "")}. Publish to move it to ${addr(cur.path)}.`
                  : `Visitors still see the version from ${cur.publishedAt ? myt(cur.publishedAt) : "the last publish"}.`
              }
            >
              <a
                href={`https://${site.domain}${cur.livePath ?? cur.path}`}
                target="_blank"
                rel="noopener"
                className={ghostSm}
              >
                Open live page
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
              {edit && (
                <ActionForm action={publishStepAction} className="flex flex-col items-end text-right">
                  {hidden({ pageId: cur.id, pageVersion: cur.version })}
                  <button type="submit" className={buttonSm}>
                    Publish changes
                  </button>
                </ActionForm>
              )}
            </StatusBox>
          ) : (
            <StatusBox
              tone="ok"
              title="Live"
              text={`at ${addr(cur.livePath ?? cur.path)}${cur.publishedAt ? ` · published ${myt(cur.publishedAt)}` : ""}`}
            >
              <a
                href={`https://${site.domain}${cur.livePath ?? cur.path}`}
                target="_blank"
                rel="noopener"
                className={ghostSm}
              >
                Open live page
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            </StatusBox>
          )}

          {edit && (
            <>
              {/* The ⋯ menu's actions. Their messages show here. */}
              <div className="mt-2 text-sm">
                <ActionForm action={cloneStepAction} id={f("clone")}>
                  {hidden(stepForm)}
                </ActionForm>
                <ActionForm action={moveStepAction} id={f("up")}>
                  {hidden({ ...stepForm, to: cur.position - 1 })}
                </ActionForm>
                <ActionForm action={moveStepAction} id={f("down")}>
                  {hidden({ ...stepForm, to: cur.position + 1 })}
                </ActionForm>
                <ActionForm action={publishStepAction} id={f("publish")}>
                  {hidden({ pageId: cur.id, pageVersion: cur.version })}
                </ActionForm>
                <ActionForm
                  action={unpublishStepAction}
                  id={f("unpublish")}
                  confirm={`Unpublish "${cur.name}"? Visitors will no longer see it.`}
                >
                  {hidden({ pageId: cur.id })}
                </ActionForm>
                <ActionForm
                  action={deleteStepAction}
                  id={f("delete")}
                  confirm={`Delete the step "${cur.name}"? This cannot be undone.`}
                >
                  {hidden(stepForm)}
                </ActionForm>
              </div>
              <Dialog id={f("rename")} title="Rename step">
                <ActionForm action={renameStepAction} className="flex flex-col gap-3">
                  {hidden(stepForm)}
                  <Field label="Name" name="name" defaultValue={cur.name} required />
                  <div className="mt-2 flex justify-end gap-2">
                    <CloseDialog className={ghostButton}>Cancel</CloseDialog>
                    <button type="submit" className={button}>
                      Save
                    </button>
                  </div>
                </ActionForm>
              </Dialog>
              <Dialog
                id={f("path")}
                title="Change web address"
                lede={cur.live ? "The live page moves to the new address when you publish again." : undefined}
              >
                <ActionForm action={setStepPathAction} className="flex flex-col gap-3">
                  {hidden(stepForm)}
                  <Field
                    label="Path"
                    name="path"
                    defaultValue={cur.path}
                    hint={`Comes after ${site.domain}. Starts with /`}
                    required
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <CloseDialog className={ghostButton}>Cancel</CloseDialog>
                    <button type="submit" className={button}>
                      Save
                    </button>
                  </div>
                </ActionForm>
              </Dialog>
            </>
          )}

          <div className="border-line mt-6 border-t pt-4">
            <h3 className="text-sm font-semibold">History</h3>
            {history.length === 0 ? (
              <p className="text-ink-muted mt-1 text-sm">
                Each time you publish, a copy is kept here so you can go back.
              </p>
            ) : (
              <ul className="mt-1 text-sm">
                {history.map((v) => (
                  <li
                    key={v.id}
                    className="border-line flex items-center justify-between gap-3 border-t py-2 first:border-t-0"
                  >
                    <span>
                      {v.publishedAt ? myt(v.publishedAt) : "—"}
                      {v.publishedBy ? ` · ${v.publishedBy}` : ""}{" "}
                      {v.status === "published" ? (
                        <Badge tone="green">Live</Badge>
                      ) : (
                        <span className="text-ink-muted">· earlier version</span>
                      )}
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
                        <button type="submit" className={ghostSm}>
                          Restore
                        </button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="border-line bg-surface-muted rounded-[14px] border p-10 text-center text-sm">
          <p className="font-medium">This funnel has no steps yet.</p>
          {edit && <p className="text-ink-muted mt-1">Use Add step to make the first one.</p>}
        </div>
      )}
    </div>
  );
}

const STATUS = {
  warn: ["bg-warn-soft", "text-warn"],
  info: ["bg-info-soft", "text-info"],
  ok: ["bg-ok-soft", "text-ok"],
} as const;

function StatusBox({
  tone,
  title,
  text,
  children,
}: {
  tone: keyof typeof STATUS;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={`mt-5 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3.5 text-sm ${STATUS[tone][0]}`}
    >
      <p className="min-w-[min(100%,240px)] flex-1">
        <b className={`font-semibold ${STATUS[tone][1]}`}>{title}</b> {text}
      </p>
      {children && <div className="flex flex-wrap items-start gap-2">{children}</div>}
    </div>
  );
}

// A range of KL days, today included. Picked by `range` (days back), or
// from/to for a custom range; 7 days by default, as on the list page.
const RANGES = [
  ["1", "Today"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
] as const;
const dayShift = (day: string, n: number) =>
  klDay(new Date(new Date(`${day}T00:00:00+08:00`).getTime() + n * 86_400_000));
const dayCount = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00+08:00`).getTime() - new Date(`${a}T00:00:00+08:00`).getTime()) /
      86_400_000,
  ) + 1;
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00+08:00`).toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
  });

// "▲ 12% on the 7 days before", or nothing when there is nothing to compare.
function Change({ now, before, span }: { now: number; before: number; span: string }) {
  if (before === 0) return now === 0 ? null : <span className="text-ink-muted">None the {span} before</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="text-ink-muted">Same as the {span} before</span>;
  return (
    <span className={pct > 0 ? "text-ok" : "text-danger"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}% on the {span} before
    </span>
  );
}

async function Stats({
  siteId,
  user,
  range,
  from,
  to,
  tabHref,
}: {
  siteId: string;
  user: User;
  range: string;
  from: string;
  to: string;
  tabHref: string;
}) {
  const today = klDay(new Date());
  const custom = DAY.test(from) && DAY.test(to) && from <= to && !range;
  const days = custom ? dayCount(from, to) : Number(RANGES.find(([r]) => r === range)?.[0] ?? 7);
  const to2 = custom ? to : today;
  const from2 = custom ? from : dayShift(to2, -(days - 1));
  const [rows, before] = await Promise.all([
    siteStats(user, siteId, from2, to2),
    siteStats(user, siteId, dayShift(from2, -days), dayShift(from2, -1)),
  ]);
  const sum = (xs: typeof rows, k: "views" | "optins" | "orders" | "revenueMyr") =>
    xs.reduce((n, r) => n + r[k], 0);
  const span = days === 1 ? "day" : `${days} days`;
  const views = sum(rows, "views");
  const optins = sum(rows, "optins");
  const orders = sum(rows, "orders");
  const revenue = sum(rows, "revenueMyr");
  const top = rows[0]?.uniques ?? 0;
  const base = tabHref.split("?")[0];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Date range"
          options={[
            ...RANGES.map(([r, label]) => ({
              label,
              href: `${base}?tab=stats&range=${r}`,
              current: !custom && days === Number(r),
            })),
          ]}
        />
        <details className="relative">
          <summary
            className={`${custom ? "bg-surface-muted text-ink" : "text-ink-muted"} hover:text-ink cursor-pointer list-none rounded-lg px-3 py-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden`}
          >
            Custom…
          </summary>
          <form
            method="get"
            action={base}
            className="border-line bg-surface absolute top-[calc(100%+6px)] left-0 z-20 flex w-max flex-wrap items-end gap-3 rounded-xl border p-3 text-sm shadow-[0_10px_30px_rgba(0,0,0,.12)]"
          >
            <input type="hidden" name="tab" value="stats" />
            <label className="flex flex-col gap-1">
              <span className="font-medium">From</span>
              <input type="date" name="from" defaultValue={from2} max={today} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">To</span>
              <input type="date" name="to" defaultValue={to2} max={today} className={field} />
            </label>
            <button type="submit" className={buttonSm}>
              Show
            </button>
          </form>
        </details>
        <span className="text-ink-muted ml-auto text-sm">
          {from2 === to2 ? shortDay(to2) : `${shortDay(from2)} – ${shortDay(to2)}`} · compared with
          the {span} before
        </span>
      </div>

      <div className={tiles}>
        <StatTile
          label="Views"
          value={views.toLocaleString("en-MY")}
          note={<Change now={views} before={sum(before, "views")} span={span} />}
        />
        <StatTile
          label="Opt-ins"
          value={optins.toLocaleString("en-MY")}
          note={<Change now={optins} before={sum(before, "optins")} span={span} />}
        />
        <StatTile
          label="Opt-in rate"
          value={`${top ? ((optins / top) * 100).toFixed(1) : "0.0"}%`}
          note="Of visitors to the first step"
        />
        <StatTile
          label="Revenue"
          value={`RM ${myr(revenue)}`}
          note={
            orders
              ? `${orders} ${orders === 1 ? "order" : "orders"} · RM ${myr(revenue / orders)} avg`
              : "No orders"
          }
        />
      </div>

      <h2 className="mt-7 font-semibold">Step by step</h2>
      <p className="text-ink-muted text-sm">Where people leave the funnel.</p>
      {rows.length === 0 ? (
        <div className="border-line bg-surface-muted mt-3.5 rounded-[14px] border p-10 text-center text-sm">
          No steps yet.
        </div>
      ) : (
        <div className={t.wrap}>
          <table className={t.table}>
            <thead>
              <tr>
                <th className={t.th}>Step</th>
                <th className={t.th}>Visitors who reached it</th>
                <th className={`${t.th} text-right`}>Views</th>
                <th className={`${t.th} text-right`}>Opt-ins</th>
                <th className={`${t.th} text-right`}>Orders</th>
                <th className={`${t.th} text-right`}>Revenue (RM)</th>
                <th className={`${t.th} text-right`}>Per view (RM)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const share = top ? r.uniques / top : 0;
                const prev = rows[i - 1];
                const left =
                  prev && prev.uniques > 0 && r.uniques <= prev.uniques
                    ? 1 - r.uniques / prev.uniques
                    : null;
                const dash = (n: number, s: string) => (n ? s : "—");
                return (
                  <tr key={r.pageId} className={t.row}>
                    <td className={t.td}>
                      <span className="font-medium">
                        {i + 1}. {r.name}
                      </span>
                      {left !== null && left > 0 && (
                        <span className="text-danger block text-xs">
                          ▼ {(left * 100).toFixed(1)}% left after {prev!.name}
                        </span>
                      )}
                    </td>
                    <td className={t.td}>
                      <span className="flex items-center gap-2.5">
                        <span className="bg-info-soft block h-2 w-[140px] shrink-0 overflow-hidden rounded">
                          <span
                            className="bg-info block h-2 rounded"
                            style={{ width: `${Math.min(100, Math.max(share > 0 ? 1 : 0, share * 100))}%` }}
                          />
                        </span>
                        <span className="text-ink-muted text-xs whitespace-nowrap tabular-nums">
                          {r.uniques.toLocaleString("en-MY")} · {(share * 100).toFixed(1)}%
                        </span>
                      </span>
                    </td>
                    <td className={`${t.td} ${t.num}`}>{r.views.toLocaleString("en-MY")}</td>
                    <td className={`${t.td} ${t.num}`}>{dash(r.optins, r.optins.toLocaleString("en-MY"))}</td>
                    <td className={`${t.td} ${t.num}`}>{dash(r.orders, String(r.orders))}</td>
                    <td className={`${t.td} ${t.num}`}>{dash(r.revenueMyr, myr(r.revenueMyr))}</td>
                    <td className={`${t.td} ${t.num}`}>{dash(r.revenueMyr, myr(r.earningsPerView))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-ink-muted mt-2 text-xs">
        Each visitor is counted once per step over the dates shown, from 25 Nov 2026. Days are
        Malaysia time.
      </p>
    </div>
  );
}

// A card in the Settings tab, with an anchor for the menu on its left.
function Card({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-line scroll-mt-6 rounded-[14px] border">
      <div className="border-line border-b px-[18px] py-4">
        <h2 className="font-semibold">{title}</h2>
        {lede && <p className="text-ink-muted mt-0.5 text-xs">{lede}</p>}
      </div>
      <div className="px-[18px] py-4">{children}</div>
    </section>
  );
}

function Toggle({
  name,
  label,
  hint,
  on,
}: {
  name: string;
  label: string;
  hint?: string;
  on: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="text-ink-muted block text-xs">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" name={name} defaultChecked={on} className={switchInput} />
    </label>
  );
}

const SECTIONS = [
  ["tracking", "Tracking"],
  ["payments", "Payments"],
  ["details", "Site details"],
  ["chat", "Chat widget"],
  ["template", "Reuse as template"],
] as const;

function General({ site, edit }: { site: Site; edit: boolean }) {
  const s = withDefaults(site.settings);
  return (
    <div className="grid items-start gap-7 md:grid-cols-[170px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="hidden flex-col gap-0.5 text-sm md:sticky md:top-6 md:flex">
        {SECTIONS.filter(([k]) => edit || k !== "template").map(([k, label]) => (
          <a key={k} href={`#${k}`} className="text-ink-muted hover:bg-surface-muted hover:text-ink rounded-lg px-2.5 py-1.5">
            {label}
          </a>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        <ActionForm action={saveSettingsAction} className="flex flex-col gap-4">
          <input type="hidden" name="siteId" value={site.id} />
          <input type="hidden" name="version" value={site.version} />
          <input type="hidden" name="section" value="general" />
          <fieldset disabled={!edit} className="contents">
            <Card id="tracking" title="Tracking" lede="Ad pixels on every step of this funnel. Leave one blank to skip it.">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Meta pixel ID" name="pixels.meta" defaultValue={s.pixels.meta} />
                <Field label="Google tag ID" name="pixels.google" defaultValue={s.pixels.google} hint="G-… or AW-…" />
                <Field label="TikTok pixel ID" name="pixels.tiktok" defaultValue={s.pixels.tiktok} />
                <Field label="LinkedIn partner ID" name="pixels.linkedin" defaultValue={s.pixels.linkedin} />
              </div>
              <div className="border-line mt-4 border-t pt-4">
                <Toggle
                  name="capi"
                  label="Send server-side events to Meta (CAPI)"
                  hint="More accurate ad tracking when browsers block pixels."
                  on={s.capi}
                />
              </div>
            </Card>
            <Card id="payments" title="Payments" lede="Whether the payment step takes real money.">
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="sr-only">Payment mode</legend>
                <label className={choiceCard}>
                  <input type="radio" name="paymentMode" value="test" defaultChecked={s.paymentMode !== "live"} className="sr-only" />
                  <span className="font-medium">Test mode</span>
                  <span className="text-ink-muted text-xs">No real money. Use it to try the funnel.</span>
                </label>
                <label className={choiceCard}>
                  <input type="radio" name="paymentMode" value="live" defaultChecked={s.paymentMode === "live"} className="sr-only" />
                  <span className="font-medium">Live</span>
                  <span className="text-ink-muted text-xs">Real payments are taken.</span>
                </label>
              </fieldset>
            </Card>
            <Card id="details" title="Site details">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Favicon" name="favicon" defaultValue={s.favicon} hint="The small icon in the browser tab. A link starting https://" />
                <Field label="Privacy policy link" name="privacyUrl" defaultValue={s.privacyUrl} hint="A link starting https://" />
              </div>
            </Card>
            <Card id="chat" title="Chat widget" lede="A WhatsApp button in the corner of every step. Leave blank for none.">
              <div className="sm:max-w-[50%]">
                <Field
                  label="WhatsApp number"
                  name="chatWidget.whatsapp"
                  defaultValue={s.chatWidget?.whatsapp}
                  hint="Digits only, with the country code, e.g. 60123456789"
                />
              </div>
            </Card>
          </fieldset>
          {edit && (
            <div className="border-line bg-surface sticky bottom-0 z-10 -mt-1 flex justify-end border-t py-3">
              <button type="submit" className={button}>
                Save settings
              </button>
            </div>
          )}
        </ActionForm>
        {edit && (
          <Card id="template" title="Reuse as template" lede="Save this funnel's steps as a template to start new funnels from.">
            <ActionForm action={saveTemplateAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="siteId" value={site.id} />
              <div className="min-w-[220px] flex-1">
                <Field label="Template name" name="name" required />
              </div>
              <button type="submit" className={ghostButton}>
                Save as template
              </button>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
