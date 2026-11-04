import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { isUuid } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import {
  createTicket,
  seesAllTickets,
  suggestCategory,
  TicketError,
  type Actor,
  type TicketRow,
} from "../tickets/service.ts";

// The inbox (docs/specs/2026-11-04-inbox-tickets-design.md §4–§6): one list
// of customer conversations from every channel. Today the website help form
// feeds it; WhatsApp (WATI), Messenger, Instagram and email join the same
// tables (sales.conversation, sales.message) as each is connected.
//
// Who sees conversations (decided 4 Nov): support and sales, super_admin and
// management see all of them; anyone else sees only conversations linked to
// a ticket of one of their teams.

export const CONVERSATION_CHANNELS = [
  "whatsapp",
  "email",
  "messenger",
  "instagram",
  "web_form",
] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];
export const CONVERSATION_STATUSES = ["open", "snoozed", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

const SEE_ALL: readonly Role[] = [
  "super_admin",
  "management",
  "support",
  "sales",
];
export const seesWholeInbox = (role: Role) => SEE_ALL.includes(role);

// WhatsApp and Messenger allow free-form replies only for a while after the
// customer's last message. 24 hours is the window as I understand it; it
// must be checked against Meta's current documentation (inbox spec §4.6)
// before replies are built.
export const REPLY_WINDOW_HOURS = 24;
const WINDOWED: readonly ConversationChannel[] = [
  "whatsapp",
  "messenger",
  "instagram",
];

export function replyWindow(
  channel: ConversationChannel,
  lastInboundAt: Date | null,
  now: Date = new Date(),
): "open" | "closed" | "not_applicable" {
  if (!WINDOWED.includes(channel)) return "not_applicable";
  if (!lastInboundAt) return "closed";
  return now.getTime() - lastInboundAt.getTime() < REPLY_WINDOW_HOURS * 3600_000
    ? "open"
    : "closed";
}

// The SQL condition for "this viewer may see conversation c".
function visible(actor: Actor) {
  const sql = db();
  if (seesWholeInbox(actor.role)) return sql`true`;
  return sql`EXISTS (
    SELECT 1 FROM sales.ticket t
    JOIN sales.team_member m ON m.team_id = t.team_id AND m.user_id = ${actor.id}
    WHERE t.conversation_id = c.id)`;
}

// ---- List ---------------------------------------------------------------------

export type InboxFilter = {
  channel?: ConversationChannel | "all";
  who?: "mine" | "unassigned" | "all";
  status?: ConversationStatus | "all";
  needsReply?: boolean;
  limit?: number;
};

export type InboxItem = {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  personName: string;
  assigneeName: string | null;
  lastMessageAt: Date | null;
  lastDirection: "in" | "out" | null;
  preview: string | null;
  openTickets: number;
};

export async function listConversations(
  actor: Actor,
  f: InboxFilter = {},
): Promise<InboxItem[]> {
  const sql = db();
  const channel = f.channel && f.channel !== "all" ? f.channel : null;
  const status = f.status ?? "open";
  const who = f.who ?? "all";
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 300);
  const rows = await sql`
    SELECT c.id, c.channel, c.status, c.last_message_at,
           p.full_name AS person_name, u.full_name AS assignee_name,
           last.direction AS last_direction, left(last.body, 140) AS preview,
           (SELECT count(*)::int FROM sales.ticket t
            WHERE t.conversation_id = c.id
              AND t.status NOT IN ('resolved','closed')) AS open_tickets
    FROM sales.conversation c
    JOIN person p ON p.id = c.person_id
    LEFT JOIN app_user u ON u.id = c.assigned_user_id
    LEFT JOIN LATERAL (
      SELECT direction, body FROM sales.message m
      WHERE m.conversation_id = c.id
      ORDER BY m.sent_at DESC, m.created_at DESC LIMIT 1
    ) last ON true
    WHERE ${visible(actor)}
      ${channel ? sql`AND c.channel = ${channel}` : sql``}
      ${status !== "all" ? sql`AND c.status = ${status}` : sql``}
      ${who === "mine" ? sql`AND c.assigned_user_id = ${actor.id}` : sql``}
      ${who === "unassigned" ? sql`AND c.assigned_user_id IS NULL` : sql``}
      ${f.needsReply ? sql`AND last.direction = 'in'` : sql``}
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    status: r.status,
    personName: r.person_name,
    assigneeName: r.assignee_name,
    lastMessageAt: r.last_message_at,
    lastDirection: r.last_direction,
    preview: r.preview,
    openTickets: r.open_tickets,
  }));
}

// ---- One conversation ---------------------------------------------------------

export type ConversationDetail = {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  assignedUserId: string | null;
  assigneeName: string | null;
  lastInboundAt: Date | null;
  replyWindow: ReturnType<typeof replyWindow>;
  person: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    preferredLanguage: string | null;
    needsReview: boolean;
  };
  messages: {
    id: string;
    direction: "in" | "out";
    body: string | null;
    sentAt: Date;
    status: string;
    senderName: string | null;
    attachments: number;
  }[];
  // Every ticket on the conversation, so no one makes a second one. Those
  // the viewer may not open (another team's, or Finance's) show only their
  // number, team and status: no subject, no link.
  tickets: {
    id: string;
    number: string;
    subject: string | null;
    status: string;
    teamName: string;
    canOpen: boolean;
  }[];
  suggestedCategory: string | null;
};

export async function conversationDetail(
  actor: Actor,
  id: string,
): Promise<ConversationDetail | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [c] = await sql`
    SELECT c.*, u.full_name AS assignee_name,
           p.full_name, p.email, p.phone_e164, p.phone, p.preferred_language,
           p.needs_review
    FROM sales.conversation c
    JOIN person p ON p.id = c.person_id
    LEFT JOIN app_user u ON u.id = c.assigned_user_id
    WHERE c.id = ${id} AND ${visible(actor)}`;
  if (!c) {
    const [exists] =
      await sql`SELECT 1 FROM sales.conversation WHERE id = ${id}`;
    if (exists)
      await writeAudit({
        userId: actor.id,
        action: "permission_denied",
        entity: "conversation",
        entityId: id,
        before: null,
        after: null,
      });
    return null;
  }
  const [messages, tickets] = await Promise.all([
    sql`
      SELECT m.id, m.direction, m.body, m.sent_at, m.status,
             cardinality(m.attachment_paths) AS attachments,
             u.full_name AS sender_name
      FROM sales.message m LEFT JOIN app_user u ON u.id = m.sent_by_user_id
      WHERE m.conversation_id = ${id}
      ORDER BY m.sent_at, m.created_at`,
    // can_open: the ticket rules of lib/tickets/service.ts canSeeTicket().
    sql`
      SELECT t.id, t.number, t.subject, t.status, tm.name AS team_name,
             (${seesAllTickets(actor.role)}
              OR t.team_id IN (SELECT team_id FROM sales.team_member WHERE user_id = ${actor.id})
              OR (NOT tm.restricted AND t.created_by = ${actor.id})) AS can_open
      FROM sales.ticket t JOIN sales.team tm ON tm.id = t.team_id
      WHERE t.conversation_id = ${id}
      ORDER BY t.created_at DESC`,
  ]);
  const lastIn = [...messages].reverse().find((m) => m.direction === "in");
  return {
    id: c.id,
    channel: c.channel,
    status: c.status,
    assignedUserId: c.assigned_user_id,
    assigneeName: c.assignee_name,
    lastInboundAt: c.last_inbound_at,
    replyWindow: replyWindow(c.channel, c.last_inbound_at),
    person: {
      id: c.person_id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone_e164 ?? c.phone,
      preferredLanguage: c.preferred_language,
      needsReview: c.needs_review,
    },
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      sentAt: m.sent_at,
      status: m.status,
      senderName: m.sender_name,
      attachments: Number(m.attachments ?? 0),
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      number: t.number,
      subject: t.can_open ? t.subject : null,
      status: t.status,
      teamName: t.team_name,
      canOpen: t.can_open,
    })),
    suggestedCategory: lastIn?.body ? await suggestCategory(lastIn.body) : null,
  };
}

// ---- Changes ------------------------------------------------------------------

// The conversation, locked, if the viewer may see it; otherwise not_found
// (the same answer as a missing one), with the refusal audited after the
// rollback.
async function withConversation<T>(
  actor: Actor,
  id: string,
  fn: (c: Record<string, any>) => Promise<T>, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T> {
  if (!isUuid(id)) throw new TicketError("not_found", "No such conversation.");
  let denied = false;
  try {
    return await withTransaction(async () => {
      const sql = db();
      const [c] = await sql`
        SELECT c.* FROM sales.conversation c
        WHERE c.id = ${id} FOR UPDATE`;
      if (!c) throw new TicketError("not_found", "No such conversation.");
      const [ok] = await sql`
        SELECT 1 FROM sales.conversation c WHERE c.id = ${id} AND ${visible(actor)}`;
      if (!ok) {
        denied = true;
        throw new TicketError("not_found", "No such conversation.");
      }
      return fn(c);
    });
  } finally {
    if (denied)
      await writeAudit({
        userId: actor.id,
        action: "permission_denied",
        entity: "conversation",
        entityId: id,
        before: null,
        after: null,
      });
  }
}

// Assign to anyone who may work the inbox (or nobody).
export async function assignConversation(
  actor: Actor,
  id: string,
  userId: string | null,
): Promise<void> {
  await withConversation(actor, id, async (c) => {
    const sql = db();
    if (userId !== null) {
      if (!isUuid(userId)) throw new TicketError("invalid", "Unknown person.");
      const [u] = await sql`
        SELECT role_code FROM app_user WHERE id = ${userId} AND is_active`;
      if (!u || !seesWholeInbox(u.role_code))
        throw new TicketError(
          "invalid",
          "Assign to an active support, sales, management or super_admin user.",
        );
    }
    if (c.assigned_user_id === userId) return;
    await sql`
      UPDATE sales.conversation SET assigned_user_id = ${userId} WHERE id = ${id}`;
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "conversation",
      entityId: id,
      before: { assignedUserId: c.assigned_user_id },
      after: { assignedUserId: userId },
    });
  });
}

export async function setConversationStatus(
  actor: Actor,
  id: string,
  status: ConversationStatus,
): Promise<void> {
  if (!CONVERSATION_STATUSES.includes(status))
    throw new TicketError("invalid", "Unknown status.");
  await withConversation(actor, id, async (c) => {
    if (c.status === status) return;
    await db()`UPDATE sales.conversation SET status = ${status} WHERE id = ${id}`;
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "conversation",
      entityId: id,
      before: { status: c.status },
      after: { status },
    });
  });
}

// "Make ticket" (spec §4.4): the agent picks the category; the team and
// assignee follow from it and the rules. The deadline counts from the
// customer's last message, not from when the agent clicked.
export async function ticketFromConversation(
  actor: Actor,
  id: string,
  input: { category: string; subject: string },
): Promise<TicketRow> {
  let found: {
    person_id: string;
    channel: string;
    last_inbound_at: Date | null;
  } | null = null;
  await withConversation(actor, id, async (c) => {
    found = c as never;
  });
  const c = found as unknown as {
    person_id: string;
    channel: ConversationChannel;
    last_inbound_at: Date | null;
  };
  return createTicket(
    {
      personId: c.person_id,
      conversationId: id,
      sourceChannel: c.channel,
      category: input.category,
      subject: input.subject,
      receivedAt: c.last_inbound_at ?? new Date(),
    },
    actor,
  );
}

// Who a conversation can be assigned to.
export async function inboxAgents(): Promise<{ id: string; name: string }[]> {
  const rows = await db()`
    SELECT id, full_name FROM app_user
    WHERE is_active AND role_code IN ('super_admin','management','support','sales')
    ORDER BY full_name`;
  return rows.map((r) => ({ id: r.id as string, name: r.full_name as string }));
}
