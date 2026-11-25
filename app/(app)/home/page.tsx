import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  CircleAlert,
  CreditCard,
  Globe,
  Mail,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canEditAutomations } from "@/lib/automations/admin";
import { canEditEmail, consentSummary, listCampaigns } from "@/lib/email/marketing";
import { failedRuns, unsubscribedAfter } from "@/lib/home/attention";
import {
  canSeePayments,
  paymentSummary,
  receivedByDay,
} from "@/lib/payments/list";
import { canViewSites } from "@/lib/sites/permissions";
import { klDay, siteSummaries } from "@/lib/sites/stats";
import { CHANNEL_LABEL, mytDay, mytTime, STATE_LABEL } from "@/lib/social/planner";
import {
  canUseSocial,
  listNeedsAction,
  listPostsBetween,
} from "@/lib/social/social";
import { STATUS_LABEL as EMAIL_STATUS, emailTone } from "../email/shared";
import { preview, stateTone } from "../social/shared";
import { Badge, button, myt, page, StatTile, tiles } from "../ui";

// Home: today's snapshot, laid out as in the reviewed UI demo (25 Nov). Each
// tile and panel shows only to the roles that can open the screen behind it,
// links there, and loads on its own, so one slow or failing number never
// holds up the rest.

const rm = (v: string | number) =>
  `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: number) => v.toLocaleString("en-MY");
const plural = (k: number, one: string, many = `${one}s`) =>
  `${n(k)} ${k === 1 ? one : many}`;

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

const icon = (I: LucideIcon) => <I className="size-[18px]" aria-hidden="true" />;

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const now = new Date();
  const first = user.fullName.split(/\s+/)[0] || user.fullName;
  // "Wednesday, 25 Nov", as in the demo.
  const part = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "Asia/Kuala_Lumpur" }).format(now);
  const today = `${part({ weekday: "long" })}, ${part({ day: "numeric" })} ${part({ month: "short" })}`;
  const r = user.role;

  return (
    <section className={page}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-balance">
            {greeting(now)}, {first}
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            {today}. Here is what needs you today.
          </p>
        </div>
      </div>

      <div className={tiles}>
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
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1.4fr_1fr]">
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

      <p className="text-ink-muted mt-7 text-[13px]">
        The inbox, enquiries (tickets) and the help form are in LEAD CRM.
      </p>
    </section>
  );
}

function TileSkeleton({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="skeleton h-[122px] rounded-[14px]" />
  ));
}

function PanelSkeleton() {
  return <div className="skeleton h-56 rounded-[14px]" />;
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
    <section className="border-line min-w-0 rounded-[14px] border p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <Link href={href} className="text-ink-muted hover:text-ink text-[13px] underline">
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
    safe("payment trend", () => receivedByDay(user, 14)),
  ]);
  if (!s) return null;
  const week = days?.slice(7) ?? null;
  const before = days?.slice(0, 7) ?? null;
  const sum = (d: { myr: number }[]) => d.reduce((a, x) => a + x.myr, 0);
  let note: string;
  if (week && before) {
    const count = week.reduce((a, x) => a + x.count, 0);
    const [w, b] = [sum(week), sum(before)];
    const change =
      b > 0
        ? ` · ${w >= b ? "up" : "down"} ${Math.round((Math.abs(w - b) / b) * 100)}% on last week`
        : "";
    note = `${plural(count, "payment")}${change}`;
  } else note = `${rm(s.receivedThisMonthMyr)} this month`;
  return (
    <>
      <StatTile
        href="/payments"
        icon={icon(CreditCard)}
        label={week ? "Paid this week" : "Paid this month"}
        value={rm(week ? sum(week) : s.receivedThisMonthMyr)}
        note={note}
        trend={week?.map((d) => d.myr)}
      />
      <StatTile
        href="/payments?view=unmatched"
        alert={s.unmatchedCount > 0}
        ok={s.unmatchedCount === 0}
        icon={icon(CircleAlert)}
        label="Unmatched payments"
        value={n(s.unmatchedCount)}
        note={s.unmatchedCount ? "Match them in the CRM" : "Nothing to match"}
      />
    </>
  );
}

async function AutomationTile() {
  const f = await safe("automation runs", failedRuns);
  if (!f) return null;
  return (
    <StatTile
      href="/automations"
      alert={f.count > 0}
      ok={f.count === 0}
      icon={icon(Zap)}
      label="Failed automation runs"
      value={n(f.count)}
      note={f.top ? `In “${f.top}”` : "All runs are fine"}
    />
  );
}

async function SitesTile({ user }: { user: CurrentUser }) {
  const to = klDay(new Date());
  const from = klDay(
    new Date(new Date(`${to}T00:00:00+08:00`).getTime() - 6 * 86_400_000),
  );
  const perDay = new Map<string, number>();
  const sums = await safe("site stats", () =>
    siteSummaries(user, "funnel", from, to, perDay),
  );
  if (!sums) return null;
  let optins = 0;
  for (const s of sums.values()) optins += s.optins;
  const days = Array.from({ length: 7 }, (_, i) =>
    klDay(new Date(new Date(`${from}T12:00:00+08:00`).getTime() + i * 86_400_000)),
  );
  return (
    <StatTile
      href="/sites"
      icon={icon(Globe)}
      label="Opt-ins, last 7 days"
      value={n(optins)}
      note={`From ${plural(sums.size, "funnel")}`}
      trend={days.map((d) => perDay.get(d) ?? 0)}
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
  const shown = [...needs, ...upcoming.filter((p) => !needs.some((x) => x.id === p.id))].slice(0, 5);
  return (
    <Panel title="Coming up on social" href="/social" linkText="Open planner">
      {shown.length === 0 ? (
        <Empty
          icon={<CalendarDays className="size-5" aria-hidden="true" />}
          tone="blue"
          text="Nothing planned for the next 7 days."
          href="/social"
          action="Plan a post"
        />
      ) : (
        <ul>
          {shown.map((p) => (
            <li key={p.id} className="border-line border-t first:border-t-0">
              <Link
                href={`/social/${p.id}`}
                className="hover:bg-hover-row -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-[9px]"
              >
                {p.media[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.media[0].url}
                    alt=""
                    className="size-[38px] shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="from-lead-blue to-info size-[38px] shrink-0 rounded-lg bg-gradient-to-br"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{preview(p, 70)}</span>
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
  const unsub = last ? await safe("unsubscribes", () => unsubscribedAfter(last.id)) : null;
  return (
    <Panel title="Last email campaign" href="/email" linkText="All campaigns">
      {last ? (
        <Link href={`/email/${last.id}`} className="block">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{last.name}</span>
            <Badge tone={emailTone(last.status)}>{EMAIL_STATUS[last.status]}</Badge>
          </span>
          <span className="text-ink-muted mt-1 mb-3 block text-sm">
            {last.sentAt
              ? `Sent ${myt(last.sentAt)}`
              : last.queuedAt
                ? `Started ${myt(last.queuedAt)}`
                : ""}
            {last.recipientCount != null && ` · ${plural(last.recipientCount, "person", "people")}`}
          </span>
          <span className="grid grid-cols-3 gap-3">
            <Figure label="Sent" value={n(last.counts.sent)} />
            <Figure
              label="Failed"
              value={n(last.counts.failed)}
              alert={last.counts.failed > 0}
            />
            <Figure label="Unsubscribed" value={unsub == null ? "—" : n(unsub)} />
          </span>
        </Link>
      ) : (
        <Empty
          icon={<Mail className="size-5" aria-hidden="true" />}
          tone="yellow"
          text="No campaign has gone out yet."
          href="/email"
          action="Start a campaign"
        />
      )}
      <p className="text-ink-muted border-line mt-3 border-t pt-2.5 text-xs">
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

// The demo's thumbnail gradients, used for the empty-state badge.
const EMPTY_TONE = {
  blue: "from-lead-blue to-info text-white",
  yellow: "from-lead-yellow to-[#f29d38] text-ink",
};

function Empty({
  icon,
  tone,
  text,
  href,
  action,
}: {
  icon: React.ReactNode;
  tone: keyof typeof EMPTY_TONE;
  text: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <span
        className={`grid size-[38px] place-items-center rounded-lg bg-gradient-to-br ${EMPTY_TONE[tone]}`}
      >
        {icon}
      </span>
      <p className="text-ink-muted text-sm">{text}</p>
      <Link href={href} className={button}>
        {action}
      </Link>
    </div>
  );
}
