import { createHash } from "node:crypto";
import { enrolmentIdFor } from "../crm/salesprocess-ids.ts";
import { db, withTransaction } from "../sql.ts";
import { lmsHandoffEnabled, type LmsNoticeKind } from "./send.ts";

// The watcher: reads CRM changes and queues LMS notices in sales.lms_notice
// (handoff spec, changed 4 Nov evening). lead_sales can't use the CRM's
// event_outbox (the CRM's worker takes every row), so it reads what the CRM
// already records:
//
//   enrolment_status_history  → enrolment.confirmed / .cancelled / .transferred
//                               (written by a CRM database trigger on every
//                               status change, whoever made it)
//   class                     → class.updated, when what the LMS holds changed
//   person                    → person.updated, when email, phone or name
//                               changed; or enrolment.confirmed once a student
//                               the LMS never got (no email) gets one
//
// Each notice's source_key names its cause, so re-reading never queues twice.
// The first run starts from "now": earlier students go through the one-off
// backfill (scripts/lms-backfill.ts).

// A history row can commit after a later one (its time is taken inside the
// writing transaction), so each run re-reads this much before the cursor.
export const OVERLAP_MINUTES = 10;

async function queue(
  kind: LmsNoticeKind,
  refId: string,
  sourceKey: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    INSERT INTO sales.lms_notice (kind, ref_id, extra, source_key)
    VALUES (${kind}, ${refId}, ${sql.json(extra as never)}, ${sourceKey})
    ON CONFLICT (source_key) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

// Was this enrolment ever confirmed? Only those were sent to the LMS, so only
// those need a cancel notice (an expired reservation never reached it).
async function everConfirmed(enrolmentId: string): Promise<boolean> {
  const [r] = await db()`
    SELECT 1 FROM enrolment_status_history
    WHERE enrolment_id = ${enrolmentId}
      AND to_status IN ('confirmed','onboarded','attended')
    LIMIT 1`;
  return Boolean(r);
}

export async function watchEnrolments(): Promise<number> {
  return withTransaction(async () => {
    const sql = db();
    // clock_timestamp(), not now(): the CRM's history trigger stamps rows
    // with clock_timestamp(), which inside one transaction is later than
    // now() (the transaction's start). Rows not yet committed at this moment
    // are picked up by the next run's overlap.
    // Kept as text all the way: a JS Date drops microseconds, which would
    // move the bound a fraction of a millisecond before a row it must
    // include. `::text::timestamptz` below makes the driver send the
    // parameter as text; a bare `::timestamptz` parameter is sent as a Date.
    const [{ now }] = await sql`SELECT clock_timestamp()::text AS now`;
    const [c] = await sql`
      SELECT read_until FROM sales.lms_cursor WHERE name = 'enrolment_status'
      FOR UPDATE`;
    if (!c) {
      await sql`
        INSERT INTO sales.lms_cursor (name, read_until)
        VALUES ('enrolment_status', ${now}::text::timestamptz)`;
      return 0;
    }
    const rows = await sql`
      SELECT h.id, h.enrolment_id, h.to_status, e.cancelled_reason
      FROM enrolment_status_history h JOIN enrolment e ON e.id = h.enrolment_id
      WHERE h.changed_at > ${c.read_until}::timestamptz
                           - make_interval(mins => ${OVERLAP_MINUTES})
        AND h.changed_at <= ${now}::text::timestamptz
      ORDER BY h.changed_at, h.id`;
    // Seats the SalesProcess import made (lead_crm #44): GHL onboarded those
    // students already, so their confirm is not sent (decided 5 Nov). Their
    // cancel and transfer still are: once adopted, they are in the LMS.
    const imported = rows.some((r) => r.to_status === "confirmed")
      ? new Set(
          (
            await sql`SELECT DISTINCT order_id FROM salesprocess_payment
                      WHERE order_id IS NOT NULL`
          ).map((p) => enrolmentIdFor(p.order_id as string)),
        )
      : new Set<string>();
    let queued = 0;
    for (const r of rows) {
      const key = `history:${r.id}`;
      const id = r.enrolment_id as string;
      if (r.to_status === "confirmed") {
        if (!imported.has(id))
          queued += Number(await queue("enrolment.confirmed", id, key));
      } else if (r.to_status === "transferred")
        queued += Number(await queue("enrolment.transferred", id, key));
      else if (
        (r.to_status === "cancelled" || r.to_status === "refunded") &&
        (await everConfirmed(id))
      )
        queued += Number(
          await queue("enrolment.cancelled", id, key, {
            reason: r.cancelled_reason ?? r.to_status,
          }),
        );
    }
    await sql`
      UPDATE sales.lms_cursor SET read_until = ${now}::text::timestamptz
      WHERE name = 'enrolment_status'`;
    return queued;
  });
}

// What the LMS holds about a class: a change to anything here is worth a
// class.updated; a seat-count or status change is not.
export function classFingerprint(c: Record<string, unknown>): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        c.code,
        c.start_date,
        c.end_date,
        c.start_time,
        c.end_time,
        c.language,
        c.mode,
        c.venue_name,
        c.venue_address,
        c.city,
        c.online_url,
        c.course_id,
      ]),
    )
    .digest("hex");
}

export const CLASS_FIELDS = `c.id, c.code, c.start_date::text, c.end_date::text,
  c.start_time::text, c.end_time::text, c.language, c.mode, c.venue_name,
  c.venue_address, c.city, c.online_url, c.course_id`;

export async function watchClasses(): Promise<number> {
  const sql = db();
  // Only classes the LMS already knows (it was sent a student in them).
  const rows = await sql.unsafe(`
    SELECT ${CLASS_FIELDS}, s.fingerprint
    FROM sales.lms_class_sent s JOIN class c ON c.id = s.class_id`);
  let queued = 0;
  for (const r of rows) {
    const fp = classFingerprint(r);
    if (fp === r.fingerprint) continue;
    queued += Number(
      await queue("class.updated", r.id as string, `class:${r.id}:${fp}`),
    );
  }
  return queued;
}

export async function watchPeople(): Promise<number> {
  const sql = db();
  let queued = 0;
  // People the LMS knows: tell it what changed, with the old email to find
  // them by (its daily sync matches by email).
  const changed = await sql`
    SELECT p.id, p.email, p.phone_e164, p.full_name, s.email AS sent_email
    FROM sales.lms_person_sent s JOIN person p ON p.id = s.person_id
    WHERE p.deleted_at IS NULL
      AND (p.email IS DISTINCT FROM s.email
           OR p.phone_e164 IS DISTINCT FROM s.phone_e164
           OR p.full_name IS DISTINCT FROM s.full_name)`;
  for (const p of changed) {
    const now = createHash("sha256")
      .update(JSON.stringify([p.email, p.phone_e164, p.full_name]))
      .digest("hex");
    queued += Number(
      await queue("person.updated", p.id as string, `person:${p.id}:${now}`, {
        previousEmail: p.sent_email ?? null,
      }),
    );
  }
  // Students skipped for having no email who now have one, still enrolled
  // in a class that hasn't ended: send them now.
  const late = await sql`
    SELECT DISTINCT n.ref_id
    FROM sales.lms_notice n
    JOIN enrolment e ON e.id = n.ref_id
    JOIN person p ON p.id = e.person_id
    JOIN class c ON c.id = e.class_id
    WHERE n.kind = 'enrolment.confirmed' AND n.skipped_reason = 'no email'
      AND p.email IS NOT NULL
      AND e.status IN ('confirmed','onboarded')
      AND c.end_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date`;
  for (const r of late)
    queued += Number(
      await queue(
        "enrolment.confirmed",
        r.ref_id as string,
        `email-added:${r.ref_id}`,
      ),
    );
  return queued;
}

export async function runWatch(): Promise<{
  enrolments: number;
  classes: number;
  people: number;
}> {
  if (!lmsHandoffEnabled()) return { enrolments: 0, classes: 0, people: 0 };
  return {
    enrolments: await watchEnrolments(),
    classes: await watchClasses(),
    people: await watchPeople(),
  };
}
