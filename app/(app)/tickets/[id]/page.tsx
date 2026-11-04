import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  activeCategories,
  activeMembers,
  ticketDetail,
  type TicketDetail,
} from "@/lib/tickets/read";
import { canMove, STATUSES } from "@/lib/tickets/service";
import {
  assignAction,
  categoryAction,
  noteAction,
  setStatusAction,
} from "../actions";
import { button, ErrorNote, field, myt, STATUS_LABEL, StatusPill } from "../ui";

// One ticket (inbox spec §5): status, category, assignee, notes and history.
// Replies to the customer arrive with the inbox (WATI), which also records
// the first response.
export default async function TicketPage({
  params,
  searchParams,
}: PageProps<"/tickets/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  const t = await ticketDetail({ id: user.id, role: user.role }, id);
  if (!t) notFound();
  const q = await searchParams;
  const error = Array.isArray(q.error) ? q.error[0] : q.error;
  const [categories, members] = await Promise.all([
    activeCategories(),
    activeMembers(t.teamId),
  ]);
  const closed = t.status === "closed";
  const moves = STATUSES.filter((s) => s !== t.status && canMove(t.status, s));

  return (
    <section className="max-w-4xl">
      <Link href="/tickets" className="text-ink-muted text-sm underline">
        Tickets
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {t.number} · {t.subject}
        </h1>
        <StatusPill status={t.status} />
      </div>
      <ErrorNote code={error} />

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        <Item label="Customer">
          {t.person.fullName}
          <span className="text-ink-muted block">
            {[t.person.email, t.person.phone].filter(Boolean).join(" · ")}
          </span>
        </Item>
        <Item label="Team">{t.teamName}</Item>
        <Item label="Assignee">{t.assigneeName ?? "Unassigned"}</Item>
        <Item label="First reply due">
          <span className={t.overdue ? "text-danger font-medium" : ""}>
            {myt(t.slaDueAt)}
            {t.overdue && " (overdue)"}
          </span>
        </Item>
        <Item label="First reply">
          {t.firstResponseAt ? myt(t.firstResponseAt) : "Not yet"}
        </Item>
        <Item label="Came in by">{t.sourceChannel.replace("_", " ")}</Item>
        {t.previous && (
          <Item label="Follows">
            <Link href={`/tickets/${t.previous.id}`} className="underline">
              {t.previous.number}
            </Link>
          </Item>
        )}
      </dl>

      {!closed && (
        <div className="border-line mt-8 grid gap-4 rounded-2xl border p-4 sm:grid-cols-3">
          <form action={setStatusAction} className="flex flex-col gap-2">
            <input type="hidden" name="ticketId" value={t.id} />
            <label className="text-sm font-medium" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" className={field} required>
              {moves.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button type="submit" className={button}>
              Change status
            </button>
          </form>

          <form action={categoryAction} className="flex flex-col gap-2">
            <input type="hidden" name="ticketId" value={t.id} />
            <label className="text-sm font-medium" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              name="category"
              className={field}
              defaultValue={t.category}
            >
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.teamName})
                </option>
              ))}
            </select>
            <button type="submit" className={button}>
              Change category
            </button>
          </form>

          <form action={assignAction} className="flex flex-col gap-2">
            <input type="hidden" name="ticketId" value={t.id} />
            <label className="text-sm font-medium" htmlFor="userId">
              Assignee ({t.teamName})
            </label>
            <select
              id="userId"
              name="userId"
              className={field}
              defaultValue={t.assignedUserId ?? ""}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button type="submit" className={button}>
              Assign
            </button>
          </form>
        </div>
      )}

      <h2 className="mt-8 font-semibold">History and notes</h2>
      <ol className="mt-3 flex flex-col gap-3">
        {t.events.map((e) => (
          <li
            key={e.id}
            className="border-line rounded-xl border px-4 py-3 text-sm"
          >
            <p className="text-ink-muted">
              {myt(e.at)} · {e.userName ?? "System"}
            </p>
            <p className="mt-1">{describe(e)}</p>
            {e.note && <p className="mt-1 whitespace-pre-wrap">{e.note}</p>}
          </li>
        ))}
      </ol>

      {!closed && (
        <form action={noteAction} className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="ticketId" value={t.id} />
          <label className="text-sm font-medium" htmlFor="note">
            Internal note (the customer doesn&apos;t see it)
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            maxLength={5000}
            required
            className={field}
          />
          <button type="submit" className={`${button} self-start`}>
            Add note
          </button>
        </form>
      )}
    </section>
  );
}

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function describe(e: TicketDetail["events"][number]): string {
  const a = e.after ?? {};
  const b = e.before ?? {};
  switch (e.kind) {
    case "created":
      return "Ticket created.";
    case "status":
      return `Status: ${STATUS_LABEL[String(b.status)] ?? b.status} → ${STATUS_LABEL[String(a.status)] ?? a.status}.`;
    case "assigned":
      return a.assignedUserId ? "Reassigned." : "Unassigned.";
    case "category":
      return `Category: ${b.category} → ${a.category}.`;
    case "first_response":
      return "First reply sent to the customer.";
    case "note":
      return "Note:";
    default:
      return e.kind;
  }
}
