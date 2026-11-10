import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { isUuid } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import { replyDueAt, type Holidays } from "./deadline.ts";

// Tickets (docs/specs/2026-11-04-inbox-tickets-design.md §3–§6).
//
// A ticket goes to a team: the first matching sales.ticket_rule, otherwise
// its category's team. Inside the team it is assigned round robin (the
// member given a ticket longest ago), unless the rule fixes the assignee or
// says none. The first-reply deadline is the same time on the next working
// day (lib/tickets/deadline.ts). Every change is a ticket_event row and an
// audit_log row.
//
// Who sees what (§6):
//   super_admin, management  every ticket
//   a team's members         their teams' tickets
//   whoever created it       their ticket, unless its team is restricted
//                            (Finance: invoice data)

export const STATUSES = [
  "new",
  "open",
  "waiting_customer",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof STATUSES)[number];
export const CHANNELS = [
  "whatsapp",
  "email",
  "messenger",
  "instagram",
  "web_form",
  "manual",
] as const;
export type TicketChannel = (typeof CHANNELS)[number];
export const PRIORITIES = ["low", "normal", "high"] as const;
export type TicketPriority = (typeof PRIORITIES)[number];

export type Actor = { id: string; role: Role };

export class TicketError extends Error {
  readonly code: "not_found" | "forbidden" | "invalid" | "send_failed";
  constructor(code: TicketError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// Raised inside a change's transaction; turned into not_found, with an
// audited permission_denied written after the rollback (so it is kept).
class Denied extends Error {
  readonly ticketId: string;
  constructor(ticketId: string) {
    super("denied");
    this.ticketId = ticketId;
  }
}

const SEE_ALL: readonly Role[] = ["super_admin", "management"];
// Roles that work the inbox, so may turn a message into a ticket (§6).
const MAY_CREATE: readonly Role[] = [
  "super_admin",
  "management",
  "support",
  "sales",
];

export const seesAllTickets = (role: Role) => SEE_ALL.includes(role);

// Status moves. Closed is final: a customer writing again opens a new ticket
// linked to it (decided 4 Nov). Resolved can be reopened by staff, or closed.
const MOVES: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ["open", "waiting_customer", "resolved", "closed"],
  open: ["waiting_customer", "resolved", "closed"],
  waiting_customer: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};
export const canMove = (from: TicketStatus, to: TicketStatus) =>
  MOVES[from].includes(to);

// ---- Holidays -------------------------------------------------------------------

export async function loadHolidays(): Promise<Holidays> {
  const rows = await db()`
    SELECT day::text AS day FROM sales.holiday
    WHERE day BETWEEN current_date - 7 AND current_date + 400`;
  return new Set(rows.map((r) => r.day as string));
}

// ---- Access ---------------------------------------------------------------------

export async function teamsOf(userId: string): Promise<string[]> {
  const rows = await db()`
    SELECT team_id FROM sales.team_member WHERE user_id = ${userId}`;
  return rows.map((r) => r.team_id as string);
}

type TicketAccessRow = {
  team_id: string;
  created_by: string | null;
  restricted: boolean;
};

export async function canSeeTicket(
  actor: Actor,
  t: TicketAccessRow,
): Promise<boolean> {
  if (seesAllTickets(actor.role)) return true;
  if ((await teamsOf(actor.id)).includes(t.team_id)) return true;
  return !t.restricted && t.created_by === actor.id;
}

export async function canCreateTickets(actor: Actor): Promise<boolean> {
  return (
    MAY_CREATE.includes(actor.role) || (await teamsOf(actor.id)).length > 0
  );
}

// A ticket the actor may see, locked for change; otherwise not_found (a
// ticket the actor may not see is reported the same way as a missing one,
// so ids can't be probed). Use inside withTicket().
async function ticketFor(actor: Actor, id: string) {
  if (!isUuid(id)) throw new TicketError("not_found", "No such ticket.");
  const [t] = await db()`
    SELECT t.*, tm.restricted
    FROM sales.ticket t JOIN sales.team tm ON tm.id = t.team_id
    WHERE t.id = ${id}
    FOR UPDATE OF t`;
  if (!t) throw new TicketError("not_found", "No such ticket.");
  if (!(await canSeeTicket(actor, t as never))) throw new Denied(id);
  return t;
}

// One change to one ticket, in a transaction, with the ticket locked.
async function withTicket<T>(
  actor: Actor,
  id: string,
  fn: (t: Record<string, any>) => Promise<T>, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T> {
  try {
    return await withTransaction(async () => fn(await ticketFor(actor, id)));
  } catch (e) {
    if (!(e instanceof Denied)) throw e;
    await writeAudit({
      userId: actor.id,
      action: "permission_denied",
      entity: "ticket",
      entityId: e.ticketId,
      before: null,
      after: null,
    });
    throw new TicketError("not_found", "No such ticket.");
  }
}

// ---- Routing --------------------------------------------------------------------

export async function suggestCategory(text: string): Promise<string | null> {
  const lower = text.toLowerCase();
  const cats = await db()`
    SELECT code, keywords FROM sales.ticket_category
    WHERE active ORDER BY position, code`;
  for (const c of cats)
    if (
      (c.keywords as string[]).some((k) => k && lower.includes(k.toLowerCase()))
    )
      return c.code as string;
  return null;
}

type Route = {
  teamId: string;
  mode: "round_robin" | "fixed" | "none";
  userId: string | null;
};

async function route(category: string, channel: TicketChannel): Promise<Route> {
  const sql = db();
  const [cat] = await sql`
    SELECT team_id FROM sales.ticket_category
    WHERE code = ${category} AND active`;
  if (!cat) throw new TicketError("invalid", "Unknown or inactive category.");
  const [rule] = await sql`
    SELECT set_team_id, assign_mode, assign_user_id FROM sales.ticket_rule
    WHERE active
      AND (match_channel IS NULL OR match_channel = ${channel})
      AND (match_category IS NULL OR match_category = ${category})
    ORDER BY position, id
    LIMIT 1`;
  return {
    teamId: (rule?.set_team_id as string | null) ?? (cat.team_id as string),
    mode: (rule?.assign_mode as Route["mode"]) ?? "round_robin",
    userId: (rule?.assign_user_id as string | null) ?? null,
  };
}

// The active member given a ticket longest ago (never-assigned first). The
// team's member rows are locked, so two tickets at once go to two people.
async function nextInTeam(teamId: string): Promise<string | null> {
  const sql = db();
  const [m] = await sql`
    SELECT m.user_id FROM sales.team_member m
    JOIN app_user u ON u.id = m.user_id AND u.is_active
    WHERE m.team_id = ${teamId}
    ORDER BY m.last_assigned_at NULLS FIRST, m.added_at, m.user_id
    LIMIT 1
    FOR UPDATE OF m`;
  return (m?.user_id as string | undefined) ?? null;
}

async function noteAssigned(teamId: string, userId: string | null) {
  if (!userId) return;
  await db()`
    UPDATE sales.team_member SET last_assigned_at = clock_timestamp()
    WHERE team_id = ${teamId} AND user_id = ${userId}`;
}

async function isActiveMember(teamId: string, userId: string) {
  const [m] = await db()`
    SELECT 1 FROM sales.team_member m
    JOIN app_user u ON u.id = m.user_id AND u.is_active
    WHERE m.team_id = ${teamId} AND m.user_id = ${userId}`;
  return Boolean(m);
}

async function event(
  ticketId: string,
  actorId: string | null,
  kind: string,
  before: unknown,
  after: unknown,
  note: string | null = null,
) {
  const sql = db();
  await sql`
    INSERT INTO sales.ticket_event (ticket_id, user_id, kind, before, after, note)
    VALUES (${ticketId}, ${actorId}, ${kind},
            ${before == null ? null : sql.json(before as never)},
            ${after == null ? null : sql.json(after as never)},
            ${note})`;
}

// ---- Create ---------------------------------------------------------------------

export type NewTicket = {
  personId: string;
  conversationId?: string | null;
  sourceChannel: TicketChannel;
  category: string;
  subject: string;
  priority?: TicketPriority;
  note?: string | null;
  previousTicketId?: string | null;
  // When the customer asked (the message's time); the deadline counts from
  // here. Defaults to now.
  receivedAt?: Date;
};

export type TicketRow = {
  id: string;
  number: string;
  team_id: string;
  assigned_user_id: string | null;
  sla_due_at: Date;
  status: TicketStatus;
};

// `actor` is null for a ticket the system makes (the website help form).
export async function createTicket(
  input: NewTicket,
  actor: Actor | null,
  holidays?: Holidays,
): Promise<TicketRow> {
  const subject = input.subject.trim().slice(0, 200);
  if (!subject) throw new TicketError("invalid", "A subject is required.");
  if (!isUuid(input.personId))
    throw new TicketError("invalid", "Unknown person.");
  if (actor && !(await canCreateTickets(actor)))
    throw new TicketError("forbidden", "You can't create tickets.");
  const due = replyDueAt(
    input.receivedAt ?? new Date(),
    holidays ?? (await loadHolidays()),
  );

  return withTransaction(async () => {
    const sql = db();
    const [p] = await sql`
      SELECT 1 FROM person WHERE id = ${input.personId} AND deleted_at IS NULL`;
    if (!p) throw new TicketError("invalid", "Unknown person.");
    const r = await route(input.category, input.sourceChannel);
    const assignee =
      r.mode === "none"
        ? null
        : r.mode === "fixed" &&
            r.userId &&
            (await isActiveMember(r.teamId, r.userId))
          ? r.userId
          : await nextInTeam(r.teamId);
    const [t] = await sql`
      INSERT INTO sales.ticket (created_by, person_id, conversation_id,
        source_channel, category, team_id, assigned_user_id, priority,
        subject, sla_due_at, previous_ticket_id)
      VALUES (${actor?.id ?? null}, ${input.personId},
        ${input.conversationId ?? null}, ${input.sourceChannel},
        ${input.category}, ${r.teamId}, ${assignee},
        ${input.priority ?? "normal"}, ${subject}, ${due},
        ${input.previousTicketId ?? null})
      RETURNING id, number, team_id, assigned_user_id, sla_due_at, status`;
    await noteAssigned(r.teamId, assignee);
    const after = {
      number: t.number,
      category: input.category,
      teamId: r.teamId,
      assignedUserId: assignee,
      slaDueAt: due.toISOString(),
    };
    await event(
      t.id,
      actor?.id ?? null,
      "created",
      null,
      after,
      input.note ?? null,
    );
    await writeAudit({
      userId: actor?.id ?? null,
      action: "create",
      entity: "ticket",
      entityId: t.id,
      before: null,
      after,
    });
    return t as unknown as TicketRow;
  });
}

// ---- Change ---------------------------------------------------------------------

export async function setStatus(
  ticketId: string,
  to: TicketStatus,
  actor: Actor,
): Promise<void> {
  if (!STATUSES.includes(to))
    throw new TicketError("invalid", "Unknown status.");
  await withTicket(actor, ticketId, async (t) => {
    if (t.status === to) return;
    if (!canMove(t.status, to))
      throw new TicketError(
        "invalid",
        `A ${t.status} ticket can't become ${to}.`,
      );
    await db()`
      UPDATE sales.ticket
      SET status = ${to}, updated_at = now(),
          resolved_at = CASE
            WHEN ${to} IN ('resolved','closed') THEN coalesce(resolved_at, now())
            ELSE NULL END
      WHERE id = ${ticketId}`;
    await event(
      ticketId,
      actor.id,
      "status",
      { status: t.status },
      { status: to },
    );
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "ticket",
      entityId: ticketId,
      before: { status: t.status },
      after: { status: to },
    });
  });
}

export async function assignTicket(
  ticketId: string,
  userId: string | null,
  actor: Actor,
): Promise<void> {
  await withTicket(actor, ticketId, async (t) => {
    if (t.status === "closed")
      throw new TicketError("invalid", "A closed ticket can't be reassigned.");
    if (
      userId !== null &&
      (!isUuid(userId) || !(await isActiveMember(t.team_id, userId)))
    )
      throw new TicketError(
        "invalid",
        "Assign to an active member of the ticket's team.",
      );
    if (t.assigned_user_id === userId) return;
    await db()`
      UPDATE sales.ticket SET assigned_user_id = ${userId}, updated_at = now()
      WHERE id = ${ticketId}`;
    await noteAssigned(t.team_id, userId);
    const before = { assignedUserId: t.assigned_user_id };
    const after = { assignedUserId: userId };
    await event(ticketId, actor.id, "assigned", before, after);
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "ticket",
      entityId: ticketId,
      before,
      after,
    });
  });
}

// A new category moves the ticket to that category's team; the assignee
// stays only if they are in the new team too.
export async function changeCategory(
  ticketId: string,
  category: string,
  actor: Actor,
): Promise<void> {
  await withTicket(actor, ticketId, async (t) => {
    const sql = db();
    if (t.status === "closed")
      throw new TicketError("invalid", "A closed ticket can't be changed.");
    if (t.category === category) return;
    const [cat] = await sql`
      SELECT team_id FROM sales.ticket_category
      WHERE code = ${category} AND active`;
    if (!cat) throw new TicketError("invalid", "Unknown or inactive category.");
    const teamId = cat.team_id as string;
    let assignee = t.assigned_user_id as string | null;
    if (teamId !== t.team_id) {
      if (!assignee || !(await isActiveMember(teamId, assignee)))
        assignee = await nextInTeam(teamId);
      await noteAssigned(teamId, assignee);
    }
    await sql`
      UPDATE sales.ticket
      SET category = ${category}, team_id = ${teamId},
          assigned_user_id = ${assignee}, updated_at = now()
      WHERE id = ${ticketId}`;
    const before = {
      category: t.category,
      teamId: t.team_id,
      assignedUserId: t.assigned_user_id,
    };
    const after = { category, teamId, assignedUserId: assignee };
    await event(ticketId, actor.id, "category", before, after);
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "ticket",
      entityId: ticketId,
      before,
      after,
    });
  });
}

export async function addNote(
  ticketId: string,
  note: string,
  actor: Actor,
): Promise<void> {
  const text = note.trim();
  if (!text || text.length > 5000)
    throw new TicketError("invalid", "A note is 1 to 5000 characters.");
  await withTicket(actor, ticketId, async () => {
    await event(ticketId, actor.id, "note", null, null, text);
  });
}

// Called when a reply goes out to the customer: the first one stops the
// deadline clock. Later replies change nothing.
export async function markFirstResponse(
  ticketId: string,
  actor: Actor,
): Promise<void> {
  await withTicket(actor, ticketId, async (t) => {
    if (t.first_response_at) return;
    await db()`
      UPDATE sales.ticket
      SET first_response_at = now(), updated_at = now(),
          status = CASE WHEN status = 'new' THEN 'open' ELSE status END
      WHERE id = ${ticketId}`;
    await event(ticketId, actor.id, "first_response", null, null);
  });
}

// The customer wrote again about a resolved or closed ticket: a new ticket,
// linked to the old one, same person, category and conversation (decided
// 4 Nov). The old ticket is closed if it was only resolved.
export async function followUpTicket(
  previousId: string,
  receivedAt: Date,
  holidays?: Holidays,
): Promise<TicketRow> {
  if (!isUuid(previousId))
    throw new TicketError("not_found", "No such ticket.");
  const [prev] = await db()`
    SELECT id, number, person_id, conversation_id, source_channel, category,
           subject, status
    FROM sales.ticket WHERE id = ${previousId}`;
  if (!prev) throw new TicketError("not_found", "No such ticket.");
  if (prev.status !== "resolved" && prev.status !== "closed")
    throw new TicketError("invalid", "The ticket is still open.");
  return withTransaction(async () => {
    if (prev.status === "resolved") {
      await db()`
        UPDATE sales.ticket SET status = 'closed', updated_at = now()
        WHERE id = ${previousId} AND status = 'resolved'`;
      await event(
        previousId,
        null,
        "status",
        { status: "resolved" },
        { status: "closed" },
      );
    }
    return createTicket(
      {
        personId: prev.person_id,
        conversationId: prev.conversation_id,
        sourceChannel: prev.source_channel,
        category: prev.category,
        subject: `Re: ${prev.subject}`.slice(0, 200),
        previousTicketId: previousId,
        note: `Follows ${prev.number}.`,
        receivedAt,
      },
      null,
      holidays,
    );
  });
}

// ---- Lists ----------------------------------------------------------------------

export type TicketListFilter = {
  scope?: "mine" | "teams" | "all";
  status?: "active" | TicketStatus;
  teamId?: string;
  overdueOnly?: boolean;
  limit?: number;
};

export type TicketListItem = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  teamName: string;
  personName: string;
  assigneeName: string | null;
  slaDueAt: Date;
  overdue: boolean;
  createdAt: Date;
};

export async function listTickets(
  actor: Actor,
  f: TicketListFilter = {},
): Promise<TicketListItem[]> {
  const sql = db();
  const all = seesAllTickets(actor.role);
  const scope = f.scope ?? "mine";
  const status = f.status ?? "active";
  const teamId = f.teamId && isUuid(f.teamId) ? f.teamId : null;
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const rows = await sql`
    SELECT t.id, t.number, t.subject, t.status, t.priority, t.category,
           tm.name AS team_name, p.full_name AS person_name,
           u.full_name AS assignee_name, t.sla_due_at, t.created_at,
           (t.first_response_at IS NULL AND t.status NOT IN ('resolved','closed')
            AND t.sla_due_at < now()) AS overdue
    FROM sales.ticket t
    JOIN sales.team tm ON tm.id = t.team_id
    JOIN person p ON p.id = t.person_id
    LEFT JOIN app_user u ON u.id = t.assigned_user_id
    WHERE (
        ${all}
        OR t.team_id IN (SELECT team_id FROM sales.team_member WHERE user_id = ${actor.id})
        OR (t.created_by = ${actor.id} AND NOT tm.restricted)
      )
      ${scope === "mine" ? sql`AND t.assigned_user_id = ${actor.id}` : sql``}
      ${scope === "teams" ? sql`AND t.team_id IN (SELECT team_id FROM sales.team_member WHERE user_id = ${actor.id})` : sql``}
      ${status === "active" ? sql`AND t.status NOT IN ('resolved','closed')` : sql`AND t.status = ${status}`}
      ${teamId ? sql`AND t.team_id = ${teamId}` : sql``}
      ${f.overdueOnly ? sql`AND t.first_response_at IS NULL AND t.status NOT IN ('resolved','closed') AND t.sla_due_at < now()` : sql``}
    ORDER BY t.sla_due_at, t.created_at
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    subject: r.subject,
    status: r.status,
    priority: r.priority,
    category: r.category,
    teamName: r.team_name,
    personName: r.person_name,
    assigneeName: r.assignee_name,
    slaDueAt: r.sla_due_at,
    overdue: r.overdue,
    createdAt: r.created_at,
  }));
}
