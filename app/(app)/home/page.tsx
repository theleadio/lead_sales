import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  CreditCard,
  Globe,
  Mail,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canEditAutomations } from "@/lib/automations/admin";
import { canEditEmail, consentSummary, listCampaigns } from "@/lib/email/marketing";
import { failedRunCount } from "@/lib/home/attention";
import {
  canSeePayments,
  paymentSummary,
  receivedByDay,
} from "@/lib/payments/list";
import { canViewSites } from "@/lib/sites/permissions";
import { klDay, siteSummaries, viewsByDay } from "@/lib/sites/stats";
import { CHANNEL_LABEL, mytDay, mytTime } from "@/lib/social/planner";
import {
  canUseSocial,
  listNeedsAction,
  listPostsBetween,
} from "@/lib/social/social";
import { STATUS_LABEL as EMAIL_STATUS, emailTone } from "../email/shared";
import { preview, stateTone } from "../social/shared";
import { STATE_LABEL } from "@/lib/social/planner";
import { Badge, myt, StatTile } from "../ui";

// Home: today's snapshot. Each tile and panel shows only to the roles that
// can open the screen behind it, links there, and loads on its own, so one
// slow or failing number never holds up the rest.

const rm = (v: string | number) =>
  `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: number) => v.toLocaleString("en-MY");

// A number that couldn't load shows as missing, not as an error page.
async function safe<T>(what: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    console.error(`home: ${what} failed`, e);
    return null;
  }
}

function greeting(now: Date): string {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Asia/Kuala_Lumpur",
    }).format(now),
  );
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const icon = "size-3.5";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const now = new Date();
  const first = user.fullName.split(/\s+/)[0] || user.fullName;
  const today = new Intl.DateTimeFormat("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(now);
  const r = user.role;

  return (
    <section className="max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        {greeting(now)}, {first}
      </h1>
      <p className="text-ink-muted mt-1 text-sm">
        {today}. Here is what needs you today.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canSeePayments(r) && (
          <Suspense fallback={<TileSkeleton count={2} />}>
            <PaymentTiles user={user} />
          </Suspense>
        )}
        {canEditAutomations(r) && (
          <Suspense fallback={<TileSkeleton count={1} />}>
            <AutomationTile />
          </Suspense>
        )}
        {canViewSites(r) && (
          <Suspense fallback={<TileSkeleton count={1} />}>
            <SitesTile user={user} />
          </Suspense>
        )}
      </div>

      {(canUseSocial(r) || canEditEmail(r)) && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          {canUseSocial(r) && (
            <Suspense fallback={<PanelSkeleton />}>
              <SocialPanel />
            </Suspense>
          )}
          {canEditEmail(r) && (
            <Suspense fallback={<PanelSkeleton />}>
              <EmailPanel />
            </Suspense>
          )}
        </div>
      )}

      <p className="text-ink-muted mt-8 text-sm">
        The inbox, enquiries (tickets) and the help form are in LEAD CRM.
      </p>
    </section>
  );
}

function TileSkeleton({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="skeleton h-[148px] rounded-2xl" />
  ));
}

function PanelSkeleton() {
  return <div className="skeleton h-56 rounded-2xl" />;
}

function Panel({
  title,
  href,
  linkText,
  children,
}: {
  title: string;
  href: string;
  linkText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line min-w-0 rounded-2xl border p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <Link href={href} className="text-ink-muted hover:text-ink text-sm">
          {linkText}
        </Link>
      </div>
      {children}
    </section>
  );
}

async function PaymentTiles({ user }: { user: CurrentUser }) {
  const [s, days] = await Promise.all([
    safe("payments", () => paymentSummary(user)),
    safe("payment trend", () => receivedByDay(user, 7)),
  ]);
  if (!s) return null;
  const week = days?.reduce((a, d) => a + d.myr, 0) ?? null;
  return (
    <>
      <StatTile
        href="/payments"
        icon={<CreditCard className={icon} aria-hidden="true" />}
        label={week == null ? "Received this month" : "Received, last 7 days"}
        value={rm(week ?? s.receivedThisMonthMyr)}
        note={`${rm(s.receivedThisMonthMyr)} this month${user.role === "sales" ? ", your deals" : ""}`}
        trend={days?.map((d) => d.myr)}
      />
      <StatTile
        href="/payments?view=unmatched"
        alert={s.unmatchedCount > 0}
        icon={<TriangleAlert className={icon} aria-hidden="true" />}
        label="Unmatched payments"
        value={n(s.unmatchedCount)}
        note={
          s.unmatchedCount
            ? `${rm(s.unmatchedMyr)} waiting to be matched in the CRM`
            : "Nothing to match"
        }
      />
    </>
  );
}

async function AutomationTile() {
  const failed = await safe("automation runs", failedRunCount);
  if (failed == null) return null;
  return (
    <StatTile
      href="/automations"
      alert={failed > 0}
      icon={<Zap className={icon} aria-hidden="true" />}
      label="Failed automation runs"
      value={n(failed)}
      note={failed ? "Open the automation to retry" : "All runs are fine"}
    />
  );
}

async function SitesTile({ user }: { user: CurrentUser }) {
  const to = klDay(new Date());
  const from = klDay(
    new Date(new Date(`${to}T00:00:00+08:00`).getTime() - 6 * 86_400_000),
  );
  const [sums, days] = await Promise.all([
    safe("site stats", () => siteSummaries(user, "funnel", from, to)),
    safe("view trend", () => viewsByDay(user, from, to)),
  ]);
  if (!sums) return null;
  let views = 0;
  let optins = 0;
  for (const s of sums.values()) {
    views += s.views;
    optins += s.optins;
  }
  return (
    <StatTile
      href="/sites"
      icon={<Globe className={icon} aria-hidden="true" />}
      label="Opt-ins, last 7 days"
      value={n(optins)}
      note={`${n(views)} page views across ${n(sums.size)} funnel${sums.size === 1 ? "" : "s"}`}
      trend={days?.map((d) => d.views)}
    />
  );
}

async function SocialPanel() {
  const now = new Date();
  const data = await safe("social", () =>
    Promise.all([
      listPostsBetween(now, new Date(now.getTime() + 7 * 86_400_000)),
      listNeedsAction(),
    ]),
  );
  if (!data) return null;
  const [upcoming, needs] = data;
  const today = mytDay(now);
  return (
    <Panel title="Coming up on social" href="/social" linkText="Open planner">
      {needs.length > 0 && (
        <Link
          href="/social"
          className="bg-warn-soft text-warn mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
        >
          <CalendarDays className="size-4" aria-hidden="true" />
          {needs.length} post{needs.length === 1 ? "" : "s"} need
          {needs.length === 1 ? "s" : ""} you to post or retry
        </Link>
      )}
      {upcoming.length === 0 ? (
        <Empty
          icon={<CalendarDays className="size-5" aria-hidden="true" />}
          text="Nothing planned for the next 7 days."
          href="/social"
          action="Plan a post"
        />
      ) : (
        <ul>
          {upcoming.slice(0, 5).map((p) => (
            <li key={p.id} className="border-line border-t first:border-t-0">
              <Link
                href={`/social/${p.id}`}
                className="hover:bg-surface-muted/70 -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5"
              >
                {p.media[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.media[0].url}
                    alt=""
                    className="size-10 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="bg-surface-muted text-ink-muted grid size-10 shrink-0 place-items-center rounded-lg"
                  >
                    <CalendarDays className="size-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {preview(p, 70)}
                  </span>
                  <span className="text-ink-muted block truncate text-xs">
                    {p.scheduledAt &&
                      (mytDay(p.scheduledAt) === today
                        ? `Today, ${mytTime(p.scheduledAt)}`
                        : myt(p.scheduledAt))}
                    {" · "}
                    {p.channels.map((c) => CHANNEL_LABEL[c.channel]).join(", ") ||
                      "No channel"}
                  </span>
                </span>
                <Badge tone={stateTone(p.state)}>{STATE_LABEL[p.state]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {upcoming.length > 5 && (
        <p className="text-ink-muted mt-1 text-xs">
          And {upcoming.length - 5} more this week.
        </p>
      )}
    </Panel>
  );
}

async function EmailPanel() {
  const data = await safe("email", () =>
    Promise.all([listCampaigns(), consentSummary()]),
  );
  if (!data) return null;
  const [campaigns, consent] = data;
  const last = campaigns.find((c) => c.status === "sending" || c.status === "sent");
  const next = campaigns
    .filter((c) => c.status === "scheduled" && c.scheduledAt)
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];
  return (
    <Panel title="Email marketing" href="/email" linkText="All campaigns">
      {last ? (
        <Link
          href={`/email/${last.id}`}
          className="hover:bg-surface-muted/70 -mx-2 block rounded-lg px-2 py-2"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{last.name}</span>
            <Badge tone={emailTone(last.status)}>
              {EMAIL_STATUS[last.status]}
            </Badge>
          </span>
          <span className="text-ink-muted block text-xs">
            {last.sentAt
              ? `Sent ${myt(last.sentAt)}`
              : last.queuedAt
                ? `Started ${myt(last.queuedAt)}`
                : ""}
            {last.recipientCount != null && ` · ${n(last.recipientCount)} people`}
          </span>
          <span className="mt-3 grid grid-cols-3 gap-2">
            <Figure label="Sent" value={n(last.counts.sent)} />
            <Figure
              label="Failed"
              value={n(last.counts.failed)}
              alert={last.counts.failed > 0}
            />
            <Figure label="Waiting" value={n(last.counts.queued)} />
          </span>
        </Link>
      ) : (
        <Empty
          icon={<Mail className="size-5" aria-hidden="true" />}
          text="No campaign has gone out yet."
          href="/email"
          action="Start a campaign"
        />
      )}
      {next?.scheduledAt && (
        <p className="border-line mt-2 border-t pt-2 text-sm">
          <Mail className="text-ink-muted mr-1.5 inline size-4 align-[-3px]" aria-hidden="true" />
          Next: <Link href={`/email/${next.id}`} className="font-medium hover:underline">{next.name}</Link>
          <span className="text-ink-muted">, {myt(next.scheduledAt)}</span>
        </p>
      )}
      <p className="text-ink-muted border-line mt-2 border-t pt-2 text-xs">
        {n(consent.consented)} of {n(consent.withEmail)} people with an email
        address can be emailed.
      </p>
    </Panel>
  );
}

function Figure({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <span className="block">
      <span className="text-ink-muted block text-xs">{label}</span>
      <span
        className={`block text-lg font-semibold tabular-nums ${alert ? "text-danger" : ""}`}
      >
        {value}
      </span>
    </span>
  );
}

function Empty({
  icon,
  text,
  href,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <span className="bg-surface-muted text-ink-muted grid size-10 place-items-center rounded-full">
        {icon}
      </span>
      <p className="text-ink-muted text-sm">{text}</p>
      <Link
        href={href}
        className="border-line hover:bg-surface-muted rounded-lg border px-3 py-1.5 text-sm font-medium"
      >
        {action}
      </Link>
    </div>
  );
}
