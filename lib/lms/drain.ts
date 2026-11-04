import { dutySuperAdmin } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import { buildLmsMessage } from "./messages.ts";
import {
  lmsHandoffEnabled,
  makeLmsSender,
  type LmsNoticeKind,
  type LmsSender,
} from "./send.ts";
import { CLASS_FIELDS, classFingerprint } from "./watch.ts";

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

// After the LMS accepts a notice, remember what it now holds, so the watcher
// only sends a later change.
async function rememberSent(kind: LmsNoticeKind, refId: string) {
  const sql = db();
  const remember = async (classId: string) => {
    const [c] = await sql.unsafe(
      `SELECT ${CLASS_FIELDS} FROM class c WHERE c.id = $1`,
      [classId],
    );
    if (!c) return;
    await sql`
      INSERT INTO sales.lms_class_sent (class_id, fingerprint)
      VALUES (${classId}, ${classFingerprint(c)})
      ON CONFLICT (class_id) DO UPDATE
        SET fingerprint = EXCLUDED.fingerprint, sent_at = now()`;
  };
  const rememberPerson = async (personId: string) => {
    await sql`
      INSERT INTO sales.lms_person_sent (person_id, email, phone_e164, full_name)
      SELECT id, email, phone_e164, full_name FROM person WHERE id = ${personId}
      ON CONFLICT (person_id) DO UPDATE
        SET email = EXCLUDED.email, phone_e164 = EXCLUDED.phone_e164,
            full_name = EXCLUDED.full_name, sent_at = now()`;
  };
  if (kind === "enrolment.confirmed" || kind === "enrolment.transferred") {
    const [e] = await sql`
      SELECT e.person_id, coalesce(n.class_id, e.class_id) AS class_id
      FROM enrolment e
      LEFT JOIN enrolment n ON n.id = e.transferred_to_enrolment_id
      WHERE e.id = ${refId}`;
    if (e) {
      await rememberPerson(e.person_id as string);
      await remember(e.class_id as string);
    }
  } else if (kind === "class.updated") await remember(refId);
  else if (kind === "person.updated") await rememberPerson(refId);
}

export async function drainLms(
  send: LmsSender = makeLmsSender(),
  batch = 20,
): Promise<{ sent: number; skipped: number; failed: number; dead: number }> {
  const out = { sent: 0, skipped: 0, failed: 0, dead: 0 };
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
          await send({
            messageId: n.id,
            type: n.kind,
            sentAt: new Date().toISOString(),
            data: built.data,
          });
          await sql`
            UPDATE sales.lms_notice SET sent_at = now(), last_error = NULL
            WHERE id = ${n.id}`;
          await rememberSent(n.kind, n.ref_id);
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
