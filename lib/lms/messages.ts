import { db } from "../sql.ts";
import type { LmsNoticeKind } from "./send.ts";

// CRM → LMS notices: what goes in each message. Moved from lead_crm PR #43
// (closed). The body is built when the notice is sent, not when it is queued,
// so the LMS always gets the current CRM data.
//
// Shapes as JM gave them (18 Nov), with LMS ids, never CRM ones:
//   enrolment.confirmed    person, class.id (the LMS class id) and
//                          enrolment.fundingType are read; the rest is ignored
//                          (no price: JM doesn't use it, Shawn 18 Nov)
//   enrolment.cancelled    { seatId }
//   enrolment.transferred  { seatId, toClassId }
//   person.updated         { previousEmail, email, fullName, phoneE164 }
// class.updated is no longer sent: the LMS owns classes (JM point 3).

// lead_crm lib/import/lms-adopt.ts GONE_REASON: the CRM's daily LMS sync
// cancels a seat with this reason when the LMS removed it, so the LMS has
// nothing left to remove.
export const GONE_REASON = "Removed from the LMS";

// Seats that give LMS access (lead_crm spec §12.4).
const SEAT_HOLDING = ["confirmed", "onboarded", "attended"];

// The class as the LMS knows it, or null while it has no LMS id (lead_crm
// migration 029, set by the CRM's daily LMS sync).
async function lmsClass(classId: string) {
  const [c] = await db()`
    SELECT c.lms_cohort_id, c.code, c.start_date::text AS start_date,
           c.end_date::text AS end_date, c.language, c.mode, c.online_url
    FROM class c WHERE c.id = ${classId}`;
  if (!c) throw new Error(`class ${classId} not found`);
  return {
    code: c.code as string,
    class: c.lms_cohort_id && {
      id: c.lms_cohort_id as string,
      code: c.code,
      startDate: c.start_date,
      endDate: c.end_date,
      language: c.language,
      mode: c.mode,
      onlineUrl: c.online_url ?? null,
    },
  };
}

async function personBlock(personId: string) {
  const [p] = await db()`
    SELECT p.id, p.full_name, p.email, p.phone_e164, p.preferred_language,
           (SELECT co.legal_name FROM company_membership m
              JOIN company co ON co.id = m.company_id
             WHERE m.person_id = p.id AND m.end_date IS NULL
               AND co.deleted_at IS NULL
             ORDER BY m.created_at DESC LIMIT 1) AS company_name
    FROM person p WHERE p.id = ${personId}`;
  if (!p) throw new Error(`person ${personId} not found`);
  return {
    id: p.id as string,
    fullName: p.full_name as string,
    email: (p.email as string | null) ?? null,
    phoneE164: (p.phone_e164 as string | null) ?? null,
    companyName: (p.company_name as string | null) ?? null,
    preferredLanguage: p.preferred_language as string,
  };
}

export type BuiltMessage =
  | {
      kind: "send";
      data: Record<string, unknown>;
      // Sent under another type than the notice's (a transfer of a seat the
      // LMS never had goes as an enrol).
      type?: LmsNoticeKind;
      // The enrolment that holds the LMS seat id after the reply; `from` is
      // the seat it moves from when the reply carries no new id.
      seat?: { on: string; from?: string };
    }
  // Nothing to send, with the reason (recorded on the outbox row's handler).
  | { kind: "skip"; reason: string; personId?: string; enrolmentId?: string }
  // Not yet: the class isn't in the LMS. Retried without using up a try.
  | { kind: "hold"; reason: string; classId: string; classCode: string };

async function enrolMessage(enrolmentId: string): Promise<BuiltMessage> {
  const [e] = await db()`
    SELECT e.id, e.status, e.payer_type,
           e.person_id, e.class_id,
           -- The seat's funding, in the LMS's own values (decided 12 Nov;
           -- lead_crm migration 023): self_funded, hrdc, internal,
           -- leaders_club, refresher, guest. Never the deal's: none = null.
           e.funding_type,
           (SELECT max(h.changed_at) FROM enrolment_status_history h
             WHERE h.enrolment_id = e.id AND h.to_status = 'confirmed')
             AS confirmed_at
    FROM enrolment e
    WHERE e.id = ${enrolmentId}`;
  if (!e) throw new Error(`enrolment ${enrolmentId} not found`);
  // The body is built at send time, which can be long after the confirm (a
  // held class, a retry): a seat cancelled, refunded or moved since must not
  // get LMS access. Its cancel was skipped (no LMS seat id), so nothing else
  // would undo it.
  if (!SEAT_HOLDING.includes(e.status as string))
    return { kind: "skip", reason: `seat is ${e.status}` };
  const person = await personBlock(e.person_id as string);
  // §4.1: the LMS can't make a login without an email. Ops are told
  // instead (by the caller), and adding the email later re-queues this
  // notice (watchPeople).
  if (!person.email)
    return {
      kind: "skip",
      reason: "no email",
      personId: person.id,
      enrolmentId: e.id as string,
    };
  const cls = await lmsClass(e.class_id as string);
  if (!cls.class)
    return {
      kind: "hold",
      reason: "class not in the LMS yet",
      classId: e.class_id as string,
      classCode: cls.code,
    };
  return {
    kind: "send",
    data: {
      enrolment: {
        id: e.id,
        status: e.status,
        payerType: e.payer_type,
        fundingType: e.funding_type ?? null,
        confirmedAt: e.confirmed_at
          ? new Date(e.confirmed_at as string).toISOString()
          : null,
      },
      person,
      class: cls.class,
    },
    seat: { on: e.id as string },
  };
}

export async function buildLmsMessage(
  kind: LmsNoticeKind,
  refId: string,
  extra: Record<string, unknown>,
): Promise<BuiltMessage> {
  const sql = db();
  switch (kind) {
    case "enrolment.confirmed":
      return enrolMessage(refId);

    case "enrolment.cancelled": {
      const [e] = await sql`
        SELECT lms_enrollment_id, cancelled_reason FROM enrolment
        WHERE id = ${refId}`;
      if (!e) throw new Error(`enrolment ${refId} not found`);
      if (e.cancelled_reason === GONE_REASON)
        return { kind: "skip", reason: "already removed in the LMS" };
      // Without the LMS's seat id the LMS can't tell which seat to remove.
      if (!e.lms_enrollment_id)
        return { kind: "skip", reason: "no LMS seat id" };
      return { kind: "send", data: { seatId: e.lms_enrollment_id } };
    }

    case "enrolment.transferred": {
      const [e] = await sql`
        SELECT e.lms_enrollment_id, e.transferred_to_enrolment_id,
               n.class_id AS to_class
        FROM enrolment e
        LEFT JOIN enrolment n ON n.id = e.transferred_to_enrolment_id
        WHERE e.id = ${refId}`;
      if (!e) throw new Error(`enrolment ${refId} not found`);
      const to = e.transferred_to_enrolment_id as string | null;
      if (!to)
        throw new Error(
          `enrolment ${refId} has no transferred_to_enrolment_id`,
        );
      // The LMS never had the old seat: enrol the student in the new class.
      if (!e.lms_enrollment_id) {
        const m = await enrolMessage(to);
        return m.kind === "send" ? { ...m, type: "enrolment.confirmed" } : m;
      }
      const cls = await lmsClass(e.to_class as string);
      if (!cls.class)
        return {
          kind: "hold",
          reason: "class not in the LMS yet",
          classId: e.to_class as string,
          classCode: cls.code,
        };
      return {
        kind: "send",
        data: { seatId: e.lms_enrollment_id, toClassId: cls.class.id },
        seat: { on: to, from: refId },
      };
    }

    // Old queued rows only; nothing queues it any more.
    case "class.updated":
      return { kind: "skip", reason: "class updates are no longer sent" };

    case "person.updated": {
      const person = await personBlock(refId);
      return {
        kind: "send",
        data: {
          personId: person.id,
          previousEmail: extra.previousEmail ?? null,
          email: person.email,
          fullName: person.fullName,
          phoneE164: person.phoneE164,
        },
      };
    }
  }
}

// Was this enrolment ever confirmed? Only those were sent to the LMS, so only
// those need a cancel notice (an expired reservation never reached it).
export async function everConfirmed(enrolmentId: string): Promise<boolean> {
  const [r] = await db()`
    SELECT 1 FROM enrolment_status_history
    WHERE enrolment_id = ${enrolmentId}
      AND to_status IN ('confirmed','onboarded','attended')
    LIMIT 1`;
  return Boolean(r);
}
