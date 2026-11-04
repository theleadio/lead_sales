import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canCreateTickets,
  listTickets,
  seesAllTickets,
  STATUSES,
  type TicketListItem,
  type TicketStatus,
} from "@/lib/tickets/service";
import { ErrorNote, myt, StatusPill } from "./ui";

// Tickets list (inbox spec §5). "My tickets" by default. Overdue tickets
// (no first reply by the deadline) are listed in red at the top, sorted by
// deadline: the dashboard view decided 4 Nov, with no notifications.

const SCOPES = [
  { key: "mine", label: "My tickets" },
  { key: "teams", label: "My teams" },
  { key: "all", label: "All I can see" },
] as const;
type Scope = (typeof SCOPES)[number]["key"];

const STATUS_FILTERS = ["active", ...STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TicketsPage({
  searchParams,
}: PageProps<"/tickets">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const actor = { id: user.id, role: user.role };
  const q = await searchParams;
  const scope: Scope = SCOPES.some((s) => s.key === one(q.scope))
    ? (one(q.scope) as Scope)
    : "mine";
  const status: StatusFilter = STATUS_FILTERS.includes(
    one(q.status) as StatusFilter,
  )
    ? (one(q.status) as StatusFilter)
    : "active";

  const [overdue, tickets, mayCreate] = await Promise.all([
    listTickets(actor, { scope: "all", overdueOnly: true, limit: 50 }),
    listTickets(actor, { scope, status: status as "active" | TicketStatus }),
    canCreateTickets(actor),
  ]);
  const link = (s: Scope, st: StatusFilter) =>
    `/tickets?scope=${s}&status=${st}`;

  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        {mayCreate && (
          <Link
            href="/tickets/new"
            className="bg-action text-action-ink rounded-lg px-4 py-2 text-sm font-medium"
          >
            New ticket
          </Link>
        )}
      </div>
      <ErrorNote code={one(q.error)} />

      {overdue.length > 0 && (
        <div className="border-danger/40 mt-6 rounded-2xl border p-4">
          <h2 className="text-danger font-semibold">
            Overdue: {overdue.length} without a first reply
          </h2>
          <TicketTable rows={overdue} />
        </div>
      )}

      <nav
        aria-label="Ticket filters"
        className="mt-6 flex flex-wrap gap-2 text-sm"
      >
        {SCOPES.map((s) => (
          <Link
            key={s.key}
            href={link(s.key, status)}
            aria-current={s.key === scope ? "page" : undefined}
            className={`rounded-full px-3 py-1 ${s.key === scope ? "bg-lead-blue/60 font-medium" : "hover:bg-surface-muted"}`}
          >
            {s.key === "all" && seesAllTickets(user.role)
              ? "All tickets"
              : s.label}
          </Link>
        ))}
        <span className="border-line mx-1 border-l" />
        {STATUS_FILTERS.map((st) => (
          <Link
            key={st}
            href={link(scope, st)}
            aria-current={st === status ? "page" : undefined}
            className={`rounded-full px-3 py-1 ${st === status ? "bg-lead-blue/60 font-medium" : "hover:bg-surface-muted"}`}
          >
            {st === "active" ? "Active" : st.replace("_", " ")}
          </Link>
        ))}
      </nav>

      {tickets.length === 0 ? (
        <div className="border-line bg-surface-muted mt-4 rounded-2xl border p-10 text-center">
          <p className="font-medium">No tickets here</p>
          <p className="text-ink-muted mt-1 text-sm">
            Tickets made from the inbox, the help form or by hand show up here.
          </p>
        </div>
      ) : (
        <TicketTable rows={tickets} />
      )}
    </section>
  );
}

function TicketTable({ rows }: { rows: TicketListItem[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-ink-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">Ticket</th>
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Team</th>
            <th className="py-2 pr-4 font-medium">Assignee</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 font-medium">Reply due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-line border-t">
              <td className="py-2 pr-4">
                <Link
                  href={`/tickets/${t.id}`}
                  className="font-medium underline"
                >
                  {t.number}
                </Link>{" "}
                {t.subject}
                {t.priority === "high" && (
                  <span className="bg-lead-yellow ml-2 rounded px-1.5 text-xs">
                    High
                  </span>
                )}
              </td>
              <td className="py-2 pr-4">{t.personName}</td>
              <td className="py-2 pr-4">{t.teamName}</td>
              <td className="py-2 pr-4">{t.assigneeName ?? "Unassigned"}</td>
              <td className="py-2 pr-4">
                <StatusPill status={t.status} />
              </td>
              <td
                className={`py-2 ${t.overdue ? "text-danger font-medium" : ""}`}
              >
                {myt(t.slaDueAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
