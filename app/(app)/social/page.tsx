import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  addDays,
  addMonths,
  CHANNEL_LABEL,
  dayStart,
  needsHand,
  isDay,
  monthGrid,
  monthStart,
  mytDay,
  mytTime,
  weekStart,
} from "@/lib/social/planner";
import {
  canUseSocial,
  listNeedsAction,
  listPostsBetween,
  listUntimedDrafts,
  type Post,
} from "@/lib/social/social";
import { button, field, myt } from "../ui";
import { markPostedAction, newPostAction, retryAction } from "./actions";
import {
  channelList,
  PostChip,
  preview,
  HandKit,
  ResultNote,
  StateBadge,
} from "./shared";

// The social planner (build plan phase 3): posts on a calendar. Facebook Page
// posts go out on their own; every other channel shows under "Needs you" when
// its time comes, for someone to post by hand and mark posted.

type View = "month" | "week" | "list";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthName = (day: string) =>
  new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SocialPage({ searchParams }: PageProps<"/social">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canUseSocial(user.role)) redirect("/home");
  const q = await searchParams;
  const view: View =
    one(q.view) === "week" ? "week" : one(q.view) === "list" ? "list" : "month";
  const today = mytDay(new Date());
  const d = one(q.d);
  const day = isDay(d) ? d : today;

  // The range the view shows, as Malaysia days [first, last).
  let first: string;
  let after: string;
  let prev: string;
  let next: string;
  let title: string;
  if (view === "month") {
    const grid = monthGrid(day);
    first = grid[0][0];
    after = addDays(grid[grid.length - 1][6], 1);
    prev = addMonths(day, -1);
    next = addMonths(day, 1);
    title = monthName(monthStart(day));
  } else if (view === "week") {
    first = weekStart(day);
    after = addDays(first, 7);
    prev = addDays(first, -7);
    next = after;
    title = `${dayLabel(first)} – ${dayLabel(addDays(first, 6))}`;
  } else {
    first = day;
    after = addDays(day, 30);
    prev = addDays(day, -30);
    next = after;
    title = `${dayLabel(first)} – ${dayLabel(addDays(after, -1))}`;
  }

  const [posts, drafts, needs] = await Promise.all([
    listPostsBetween(dayStart(first), dayStart(after)),
    listUntimedDrafts(),
    listNeedsAction(),
  ]);
  const byDay = new Map<string, Post[]>();
  for (const p of posts) {
    const k = mytDay(p.scheduledAt!);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const href = (v: View, dd: string) => `/social?view=${v}&d=${dd}`;
  const tab = (v: View, label: string) => (
    <Link
      href={href(v, day)}
      aria-current={view === v ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm ${view === v ? "bg-surface-muted font-medium" : "text-ink-muted"}`}
    >
      {label}
    </Link>
  );

  return (
    <section className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Social planner</h1>
        <div className="flex items-center gap-3">
          <Link href="/social/library" className="text-sm underline">
            Image library
          </Link>
          <form action={newPostAction}>
            <button type="submit" className={button}>
              New post
            </button>
          </form>
        </div>
      </div>
      <p className="text-ink-muted mt-1 text-sm">
        Facebook Page posts go out on their own once auto-posting is set up;
        until then, or if one isn&apos;t out 15 minutes after its time, it
        joins the other channels under &quot;Needs you&quot; to post by hand.
        All times are Malaysia time.
      </p>
      <ResultNote code={one(q.result)} why={one(q.why)} />

      {needs.length > 0 && <NeedsYou posts={needs} />}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={href(view, prev)} className="border-line rounded-lg border px-3 py-1.5 text-sm" aria-label="Earlier">
            ‹
          </Link>
          <Link href={href(view, today)} className="border-line rounded-lg border px-3 py-1.5 text-sm">
            Today
          </Link>
          <Link href={href(view, next)} className="border-line rounded-lg border px-3 py-1.5 text-sm" aria-label="Later">
            ›
          </Link>
          <h2 className="ml-2 font-medium">{title}</h2>
        </div>
        <nav aria-label="View" className="border-line flex gap-1 rounded-xl border p-1">
          {tab("month", "Month")}
          {tab("week", "Week")}
          {tab("list", "List")}
        </nav>
      </div>

      {view === "month" && (
        <Month day={day} today={today} byDay={byDay} />
      )}
      {view === "week" && (
        <Week first={first} today={today} byDay={byDay} />
      )}
      {view === "list" && <List posts={posts} />}

      {drafts.length > 0 && (
        <div className="mt-8">
          <h2 className="font-medium">Drafts without a time</h2>
          <ul className="mt-2 space-y-2">
            {drafts.map((p) => (
              <li key={p.id}>
                <Link href={`/social/${p.id}`} className="underline">
                  {preview(p)}
                </Link>
                <span className="text-ink-muted text-sm"> · started {myt(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NewOnDay({ day }: { day: string }) {
  return (
    <form action={newPostAction}>
      <input type="hidden" name="day" value={day} />
      <button
        type="submit"
        className="text-ink-muted hover:text-ink cursor-pointer text-xs"
        aria-label={`New post on ${dayLabel(day)}`}
      >
        +
      </button>
    </form>
  );
}

function Month({
  day,
  today,
  byDay,
}: {
  day: string;
  today: string;
  byDay: Map<string, Post[]>;
}) {
  const month = day.slice(0, 7);
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="grid min-w-[56rem] grid-cols-7 gap-px">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-ink-muted px-2 pb-1 text-xs font-medium">
            {w}
          </div>
        ))}
        {monthGrid(day).flat().map((dd) => (
          <div
            key={dd}
            className={`border-line min-h-28 rounded-lg border p-1.5 ${dd.slice(0, 7) === month ? "" : "bg-surface-muted/60"}`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-xs ${dd === today ? "bg-lead-yellow rounded-full px-1.5 font-semibold" : "text-ink-muted"}`}
              >
                {Number(dd.slice(8))}
              </span>
              {dd >= today && <NewOnDay day={dd} />}
            </div>
            <div className="mt-1 space-y-1">
              {(byDay.get(dd) ?? []).map((p) => (
                <PostChip key={p.id} p={p} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Week({
  first,
  today,
  byDay,
}: {
  first: string;
  today: string;
  byDay: Map<string, Post[]>;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="grid min-w-[56rem] grid-cols-7 gap-2">
        {days.map((dd) => (
          <div key={dd} className="border-line min-h-64 rounded-xl border p-2">
            <div className="flex items-center justify-between">
              <span
                className={`text-sm ${dd === today ? "bg-lead-yellow rounded-full px-2 font-semibold" : "font-medium"}`}
              >
                {dayLabel(dd)}
              </span>
              {dd >= today && <NewOnDay day={dd} />}
            </div>
            <div className="mt-2 space-y-1.5">
              {(byDay.get(dd) ?? []).map((p) => (
                <PostChip key={p.id} p={p} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function List({ posts }: { posts: Post[] }) {
  if (posts.length === 0)
    return (
      <div className="border-line bg-surface-muted mt-4 rounded-2xl border p-10 text-center">
        <p className="font-medium">Nothing planned for these 30 days</p>
        <p className="text-ink-muted mt-1 text-sm">
          Start a new post, pick its channels and a time.
        </p>
      </div>
    );
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-ink-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pr-4 font-medium">Post</th>
            <th className="py-2 pr-4 font-medium">Channels</th>
            <th className="py-2 pr-4 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id} className="border-line border-t">
              <td className="py-2 pr-4 whitespace-nowrap">
                {p.scheduledAt ? myt(p.scheduledAt) : "—"}
              </td>
              <td className="py-2 pr-4">
                <Link href={`/social/${p.id}`} className="underline">
                  {preview(p, 80)}
                </Link>
              </td>
              <td className="py-2 pr-4">{channelList(p)}</td>
              <td className="py-2 pr-4">
                <StateBadge state={p.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Posts waiting for a person: a manual channel whose time has come, or a
// Facebook post that failed.
function NeedsYou({ posts }: { posts: Post[] }) {
  const now = new Date();
  return (
    <div className="border-lead-yellow mt-6 rounded-2xl border-2 p-4">
      <h2 className="font-medium">Needs you</h2>
      <ul className="mt-2 space-y-4">
        {posts.map((p) => (
          <li key={p.id} className="text-sm">
            <p>
              <Link href={`/social/${p.id}`} className="font-medium underline">
                {preview(p, 80)}
              </Link>
              <span className="text-ink-muted">
                {" "}
                · {p.scheduledAt ? (mytDay(p.scheduledAt) === mytDay(now) ? `today ${mytTime(p.scheduledAt)}` : myt(p.scheduledAt)) : ""}
              </span>
            </p>
            <div className="mt-1">
              <HandKit p={p} />
            </div>
            <ul className="mt-2 space-y-1">
              {p.channels
                .filter(
                  (c) => c.status === "failed" || needsHand(c, p.scheduledAt, now),
                )
                .map((c) => (
                  <li key={c.channel} className="flex flex-wrap items-center gap-2">
                    <span className="w-28 font-medium">{CHANNEL_LABEL[c.channel]}</span>
                    {c.status === "failed" && (
                      <>
                        <span className="text-danger">{c.error ?? "Failed"}</span>
                        <form action={retryAction}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="channel" value={c.channel} />
                          <input type="hidden" name="back" value="planner" />
                          <button type="submit" className="cursor-pointer underline">
                            Retry
                          </button>
                        </form>
                      </>
                    )}
                    <form action={markPostedAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="channel" value={c.channel} />
                      <input type="hidden" name="back" value="planner" />
                      <input
                        name="url"
                        type="url"
                        placeholder="Link to the live post (optional)"
                        className={`${field} w-64 py-1`}
                      />
                      <button type="submit" className="cursor-pointer underline">
                        {c.status === "failed" ? "I posted it by hand" : "Mark posted"}
                      </button>
                    </form>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
