import { isUuid } from "../crm/people.ts";
import { normalizeEmail } from "../crm/email.ts";
import { normalizePhoneE164 } from "../crm/phone.ts";
import { writeAudit } from "../audit.ts";
import { db } from "../sql.ts";
import { canSeeTicket, type Actor, type TicketStatus } from "./service.ts";

// What the ticket screens read. Access is the same as for changes
// (lib/tickets/service.ts): a ticket the viewer may not see is null, as if
// missing, and the refusal is audited.

export type TicketDetail = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  category: string;
  sourceChannel: string;
  teamId: string;
  teamName: string;
  assignedUserId: string | null;
  assigneeName: string | null;
  person: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  };
  slaDueAt: Date;
  overdue: boolean;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  previous: { id: string; number: string } | null;
  events: {
    id: string;
    at: Date;
    kind: string;
    userName: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    note: string | null;
  }[];
};

export async function ticketDetail(
  actor: Actor,
  id: string,
): Promise<TicketDetail | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [t] = await sql`
    SELECT t.*, tm.name AS team_name, tm.restricted,
           p.full_name AS person_name, p.email AS person_email,
           p.phone_e164 AS person_phone,
           u.full_name AS assignee_name,
           prev.number AS previous_number,
           (t.first_response_at IS NULL AND t.status NOT IN ('resolved','closed')
            AND t.sla_due_at < now()) AS overdue
    FROM sales.ticket t
    JOIN sales.team tm ON tm.id = t.team_id
    JOIN person p ON p.id = t.person_id
    LEFT JOIN app_user u ON u.id = t.assigned_user_id
    LEFT JOIN sales.ticket prev ON prev.id = t.previous_ticket_id
    WHERE t.id = ${id}`;
  if (!t) return null;
  if (!(await canSeeTicket(actor, t as never))) {
    await writeAudit({
      userId: actor.id,
      action: "permission_denied",
      entity: "ticket",
      entityId: id,
      before: null,
      after: null,
    });
    return null;
  }
  const events = await sql`
    SELECT e.id, e.created_at, e.kind, e.before, e.after, e.note,
           u.full_name AS user_name
    FROM sales.ticket_event e LEFT JOIN app_user u ON u.id = e.user_id
    WHERE e.ticket_id = ${id}
    ORDER BY e.created_at, e.id`;
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    sourceChannel: t.source_channel,
    teamId: t.team_id,
    teamName: t.team_name,
    assignedUserId: t.assigned_user_id,
    assigneeName: t.assignee_name,
    person: {
      id: t.person_id,
      fullName: t.person_name,
      email: t.person_email,
      phone: t.person_phone,
    },
    slaDueAt: t.sla_due_at,
    overdue: t.overdue,
    firstResponseAt: t.first_response_at,
    resolvedAt: t.resolved_at,
    createdAt: t.created_at,
    previous: t.previous_ticket_id
      ? { id: t.previous_ticket_id, number: t.previous_number }
      : null,
    events: events.map((e) => ({
      id: e.id,
      at: e.created_at,
      kind: e.kind,
      userName: e.user_name,
      before: e.before,
      after: e.after,
      note: e.note,
    })),
  };
}

export async function activeCategories() {
  const rows = await db()`
    SELECT c.code, c.label_en, t.name AS team_name
    FROM sales.ticket_category c JOIN sales.team t ON t.id = c.team_id
    WHERE c.active ORDER BY c.position, c.code`;
  return rows.map((r) => ({
    code: r.code as string,
    label: r.label_en as string,
    teamName: r.team_name as string,
  }));
}

export async function teams() {
  const rows = await db()`SELECT id, name FROM sales.team ORDER BY name`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
}

export async function activeMembers(teamId: string) {
  if (!isUuid(teamId)) return [];
  const rows = await db()`
    SELECT u.id, u.full_name FROM sales.team_member m
    JOIN app_user u ON u.id = m.user_id AND u.is_active
    WHERE m.team_id = ${teamId}
    ORDER BY u.full_name`;
  return rows.map((r) => ({ id: r.id as string, name: r.full_name as string }));
}

// A ticket made by hand (a phone call, a walk-in) is for someone already in
// the CRM: found by email or phone, the same normalised keys the CRM's
// dedupe uses. A new contact is added in the CRM first.
export async function findPersonByContact(
  contact: string,
): Promise<{ id: string; fullName: string }[]> {
  const raw = contact.trim();
  if (!raw) return [];
  const sql = db();
  const rows = raw.includes("@")
    ? await sql`
        SELECT id, full_name FROM person
        WHERE email_norm = ${normalizeEmail(raw)}
          AND deleted_at IS NULL AND merged_into_id IS NULL
        LIMIT 5`
    : await (async () => {
        const e164 = normalizePhoneE164(raw);
        if (!e164) return [];
        return sql`
          SELECT id, full_name FROM person
          WHERE phone_e164 = ${e164}
            AND deleted_at IS NULL AND merged_into_id IS NULL
          LIMIT 5`;
      })();
  return rows.map((r) => ({
    id: r.id as string,
    fullName: r.full_name as string,
  }));
}
