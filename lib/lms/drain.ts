import { dutySuperAdmin } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import { buildLmsMessage } from "./messages.ts";
import {
  lmsHandoffEnabled,
  makeLmsSender,
  type LmsNoticeKind,
  type LmsSender,
} from "./send.ts";

// Sends due notices from sales.lms_notice. The same retry schedule as the
// CRM's own event worker (lead_crm lib/events/drain.ts): wait 30 s, 2 min,
// 10 min, 1 h, and after the 5th failure the notice is dead (shown on the
// integration-health page; revived by hand).
export const MAX_ATTEMPTS = 5;
export const BACKOFF_SECONDS = [30, 120, 600, 3600];

type Row = {
  id: string;
  kind: LmsNoticeKind;
  ref_id: string;
  extra: Record<string, unknown>;
  attempts: number;
};

// A held notice (its class isn't in the LMS yet) is looked at again after
// this, without using up a try.
export const HOLD_MINUTES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// After the LMS accepts an enrolment, remember who it now holds, so the
// watcher sends a later change to their contact details.
async function rememberPerson(kind: LmsNoticeKind, refId: string) {
  if (kind !== "enrolment.confirmed" && kind !== "enrolment.transferred")
    return;
  await db()`
    INSERT INTO sales.lms_person_sent (person_id, email, phone_e164, full_name)
    SELECT p.id, p.email, p.phone_e164, p.full_name
    FROM enrolment e JOIN person p ON p.id = e.person_id
    WHERE e.id = ${refId}
    ON CONFLICT (person_id) DO UPDATE
      SET email = EXCLUDED.email, phone_e164 = EXCLUDED.phone_e164,
          full_name = EXCLUDED.full_name, sent_at = now()`;
}

// Keep the LMS's seat id on the CRM seat (lead_crm migration 028): a later
// cancel or transfer names the seat by it. A transfer whose reply carries no
// new id keeps the old one, moved to the new seat (the column is unique).
// shortcut: reads the reply's `seatId`, JM's own name in his message shapes;
// change it if his reply uses another field.
async function saveSeat(
  seat: { on: string; from?: string },
  reply: Record<string, unknown>,
) {
  const sql = db();
  // Not a uuid (the column's type): kept out, so the send isn't undone.
  let id =
    typeof reply.seatId === "string" && UUID.test(reply.seatId)
      ? reply.seatId
      : null;
  if (seat.from) {
    const [old] = await sql`
      SELECT lms_enrollment_id FROM enrolment WHERE id = ${seat.from}`;
    await sql`UPDATE enrolment SET lms_enrollment_id = NULL WHERE id = ${seat.from}`;
    id ??= (old?.lms_enrollment_id as string | null) ?? null;
  }
  if (id)
    await sql`UPDATE enrolment SET lms_enrollment_id = ${id} WHERE id = ${seat.on}`;
}

export async function drainLms(
  send: LmsSender = makeLmsSender(),
  batch = 20,
): Promise<{
  sent: number;
  skipped: number;
  held: number;
  failed: number;
  dead: number;
}> {
  const out = { sent: 0, skipped: 0, held: 0, failed: 0, dead: 0 };
  if (!lmsHandoffEnabled()) return out;
  await withTransaction(async () => {
    const sql = db();
    const rows = (await sql`
      SELECT id, kind, ref_id, extra, attempts FROM sales.lms_notice
      WHERE sent_at IS NULL AND dead_at IS NULL AND skipped_reason IS NULL
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at, created_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED`) as unknown as Row[];

    for (const n of rows) {
      try {
        await withTransaction(async () => {
          const built = await buildLmsMessage(n.kind, n.ref_id, n.extra);
          if (built.kind === "skip") {
            await sql`
              UPDATE sales.lms_notice SET skipped_reason = ${built.reason}
              WHERE id = ${n.id}`;
            // Spec §4.1: no email, no LMS login. Ops add one; the watcher
            // then sends the student (watchPeople).
            if (built.enrolmentId && built.personId)
              await sql`
                INSERT INTO task (type, title, person_id, enrolment_id,
                                  assigned_user_id, due_at, notes, source_key)
                VALUES ('other', 'Add an email so the LMS account can be made',
                        ${built.personId}, ${built.enrolmentId},
                        ${await dutySuperAdmin()}, now(),
                        ${"The student has no email, so the LMS can't create their login. Adding one sends them to the LMS automatically."},
                        ${`lms:${n.id}:no-email`})
                ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;
            out.skipped++;
            return;
          }
          if (built.kind === "hold") {
            await sql`
              UPDATE sales.lms_notice
              SET last_error = ${built.reason},
                  next_attempt_at = now() + make_interval(mins => ${HOLD_MINUTES})
              WHERE id = ${n.id}`;
            // One task per class, however many students wait on it.
            await sql`
              INSERT INTO task (type, title, assigned_user_id, due_at, notes,
                                source_key)
              VALUES ('other', ${`Create class ${built.classCode} in the LMS`},
                      ${await dutySuperAdmin()}, now(),
                      ${"Students paid for this class, but it isn't in the LMS yet, so they can't get access. Create it in the LMS; the CRM links it in its next LMS sync and sends the students then."},
                      ${`lms:class:${built.classId}:not-in-lms`})
              ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;
            out.held++;
            return;
          }
          const reply = await send({
            messageId: n.id,
            type: built.type ?? n.kind,
            sentAt: new Date().toISOString(),
            data: built.data,
          });
          await sql`
            UPDATE sales.lms_notice SET sent_at = now(), last_error = NULL
            WHERE id = ${n.id}`;
          if (built.seat) await saveSeat(built.seat, reply.body);
          await rememberPerson(n.kind, n.ref_id);
          out.sent++;
        });
      } catch (err) {
        const message = (
          err instanceof Error ? err.message : String(err)
        ).slice(0, 500);
        const attempts = n.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await sql`
            UPDATE sales.lms_notice
            SET attempts = ${attempts}, last_error = ${message}, dead_at = now()
            WHERE id = ${n.id}`;
          out.dead++;
        } else {
          const wait = BACKOFF_SECONDS[attempts - 1];
          await sql`
            UPDATE sales.lms_notice
            SET attempts = ${attempts}, last_error = ${message},
                next_attempt_at = now() + make_interval(secs => ${wait})
            WHERE id = ${n.id}`;
        }
        out.failed++;
      }
    }
  });
  return out;
}
