import type { Role } from "../auth/roles.ts";
import { db } from "../sql.ts";

// The Payments screen (build plan §3, phase 2b): a read-only list of the CRM's
// `payment` rows. It changes nothing. Recording a manual payment stays in the
// CRM's enrolment screen, and matching an unmatched Stripe payment (§11.3) is
// built in lead_crm (branch feat/match-payment), so this screen links there.
//
// Who sees what follows the CRM's permission table (lead_crm
// lib/auth/permissions.ts, spec §6): super_admin, management and operations
// see every payment; sales only payments on deals they own (footnote ²);
// marketing, support and part_time none.

const ALL: readonly Role[] = ["super_admin", "management", "operations"];
export const canSeePayments = (role: Role) =>
  ALL.includes(role) || role === "sales";
const seesOwnDealsOnly = (role: Role) => role === "sales";

export const PAYMENT_VIEWS = ["all", "unmatched", "refunds"] as const;
export type PaymentView = (typeof PAYMENT_VIEWS)[number];
export const isPaymentView = (v: unknown): v is PaymentView =>
  PAYMENT_VIEWS.includes(v as PaymentView);

export const PAGE_SIZE = 50;

export type PaymentRow = {
  id: string;
  paidAt: Date | null;
  createdAt: Date;
  amountMyr: string;
  refundedMyr: string;
  method: string;
  status: string;
  matched: boolean;
  personId: string | null;
  personName: string | null;
  personEmail: string | null;
  enrolmentId: string | null;
  dealId: string | null;
  classCode: string | null;
  reference: string | null;
  notes: string | null;
  openMatchTaskId: string | null;
};

export type PaymentSummary = {
  receivedThisMonthMyr: string;
  refundedThisMonthMyr: string;
  unmatchedCount: number;
  unmatchedMyr: string;
};

type Viewer = { id: string; role: Role };

// The person is the enrolment's, else the deal's. A payment can carry both
// (the webhook sets the enrolment's deal); the enrolment wins, as in the CRM.
function scope(viewer: Viewer) {
  const sql = db();
  return seesOwnDealsOnly(viewer.role)
    ? sql`AND d.owner_user_id = ${viewer.id}`
    : sql``;
}

function viewFilter(view: PaymentView) {
  const sql = db();
  if (view === "unmatched") return sql`AND p.match_status = 'unmatched'`;
  if (view === "refunds") return sql`AND p.refunded_amount_myr > 0`;
  return sql``;
}

// Search by payer name, email, class code, Stripe id or reference. ILIKE with
// the wildcards escaped, so a typed % or _ is matched literally.
function searchFilter(q: string) {
  const sql = db();
  const t = q.trim();
  if (!t) return sql``;
  const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`AND (per.full_name ILIKE ${like} OR per.email ILIKE ${like}
              OR c.code ILIKE ${like} OR p.reference_no ILIKE ${like}
              OR p.stripe_payment_intent_id ILIKE ${like}
              OR p.stripe_checkout_session_id ILIKE ${like})`;
}

export async function listPayments(
  viewer: Viewer,
  opts: { view: PaymentView; q?: string; page?: number },
): Promise<{ rows: PaymentRow[]; hasMore: boolean }> {
  if (!canSeePayments(viewer.role)) return { rows: [], hasMore: false };
  const sql = db();
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const rows = await sql`
    SELECT p.id, p.paid_at, p.created_at, p.amount_myr::text AS amount_myr,
           p.refunded_amount_myr::text AS refunded_myr, p.method, p.status,
           p.match_status, p.enrolment_id, p.reference_no, p.notes,
           coalesce(p.deal_id, e.deal_id) AS deal_id,
           per.id AS person_id, per.full_name, per.email, c.code AS class_code,
           (SELECT t.id FROM task t
             WHERE t.payment_id = p.id AND t.type = 'match_payment'
               AND t.done_at IS NULL
             ORDER BY t.created_at LIMIT 1) AS open_task_id
    FROM payment p
    LEFT JOIN enrolment e ON e.id = p.enrolment_id
    LEFT JOIN deal d ON d.id = coalesce(p.deal_id, e.deal_id)
    LEFT JOIN person per ON per.id = coalesce(e.person_id, d.person_id)
    LEFT JOIN class c ON c.id = e.class_id
    WHERE true ${scope(viewer)} ${viewFilter(opts.view)}
          ${searchFilter(opts.q ?? "")}
    ORDER BY coalesce(p.paid_at, p.created_at) DESC, p.id
    LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`;

  const shown = rows.slice(0, PAGE_SIZE);
  // §6: every sight of a payment record is audit-logged, as the CRM's
  // enrolment screen does per payment. One insert for the page, not 50.
  if (shown.length)
    await sql`
      INSERT INTO audit_log (user_id, action, entity, entity_id)
      SELECT ${viewer.id}, 'view', 'payment', id
      FROM unnest(${shown.map((r) => r.id as string)}::uuid[]) AS id`;

  return {
    hasMore: rows.length > PAGE_SIZE,
    rows: shown.map((r) => ({
      id: r.id as string,
      paidAt: (r.paid_at as Date | null) ?? null,
      createdAt: r.created_at as Date,
      amountMyr: r.amount_myr as string,
      refundedMyr: r.refunded_myr as string,
      method: r.method as string,
      status: r.status as string,
      matched: r.match_status === "matched",
      personId: (r.person_id as string | null) ?? null,
      personName: (r.full_name as string | null) ?? null,
      personEmail: (r.email as string | null) ?? null,
      enrolmentId: (r.enrolment_id as string | null) ?? null,
      dealId: (r.deal_id as string | null) ?? null,
      classCode: (r.class_code as string | null) ?? null,
      reference: (r.reference_no as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      openMatchTaskId: (r.open_task_id as string | null) ?? null,
    })),
  };
}

// Totals for the tiles above the list, in Malaysia time months. "Received"
// counts money that arrived (succeeded, or later refunded in part or full);
// refunds count by when they were last refunded.
export async function paymentSummary(
  viewer: Viewer,
  now: Date = new Date(),
): Promise<PaymentSummary> {
  const empty = {
    receivedThisMonthMyr: "0.00",
    refundedThisMonthMyr: "0.00",
    unmatchedCount: 0,
    unmatchedMyr: "0.00",
  };
  if (!canSeePayments(viewer.role)) return empty;
  const sql = db();
  const [s] = await sql`
    WITH bounds AS (
      SELECT date_trunc('month', ${now}::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')
               AT TIME ZONE 'Asia/Kuala_Lumpur' AS start
    ), scoped AS (
      SELECT p.* FROM payment p
      LEFT JOIN enrolment e ON e.id = p.enrolment_id
      LEFT JOIN deal d ON d.id = coalesce(p.deal_id, e.deal_id)
      WHERE true ${scope(viewer)}
    )
    SELECT
      coalesce(sum(amount_myr) FILTER (
        WHERE status IN ('succeeded','refunded','partially_refunded')
          AND coalesce(paid_at, created_at) >= (SELECT start FROM bounds)
          AND coalesce(paid_at, created_at) <= ${now}), 0)::numeric(12,2)::text
        AS received,
      coalesce(sum(refunded_amount_myr) FILTER (
        WHERE refunded_at >= (SELECT start FROM bounds)
          AND refunded_at <= ${now}), 0)::numeric(12,2)::text AS refunded,
      count(*) FILTER (WHERE match_status = 'unmatched'
                         AND status = 'succeeded')::int AS unmatched_count,
      coalesce(sum(amount_myr) FILTER (WHERE match_status = 'unmatched'
                         AND status = 'succeeded'), 0)::numeric(12,2)::text
        AS unmatched_myr
    FROM scoped`;
  return {
    receivedThisMonthMyr: s.received as string,
    refundedThisMonthMyr: s.refunded as string,
    unmatchedCount: s.unmatched_count as number,
    unmatchedMyr: s.unmatched_myr as string,
  };
}
