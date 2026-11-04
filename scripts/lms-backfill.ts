// One-off CRM → LMS backfill at go-live (decided 4 Nov): queues an
// enrolment.confirmed notice for every confirmed or onboarded student in a
// class that hasn't ended; `npm run lms:run` then sends them. Safe to re-run:
// each enrolment is queued once (source_key) and the LMS upserts by id.
//
//   npm run lms:backfill                 dry run: counts only
//   npm run lms:backfill -- --apply      queue them
import { closeDb, db } from "../lib/sql.ts";

const apply = process.argv.includes("--apply");
try {
  const sql = db();
  const rows = await sql`
    SELECT e.id FROM enrolment e JOIN class c ON c.id = e.class_id
    WHERE e.status IN ('confirmed','onboarded') AND c.status <> 'cancelled'
      AND c.end_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
    ORDER BY c.start_date, e.id`;
  console.log(`enrolments to send: ${rows.length}`);
  if (!apply) console.log("dry run: nothing queued (add --apply)");
  else {
    const queued = await sql`
      INSERT INTO sales.lms_notice (kind, ref_id, source_key)
      SELECT 'enrolment.confirmed', id, 'backfill:' || id
      FROM unnest(${rows.map((r) => r.id as string)}::uuid[]) AS id
      ON CONFLICT (source_key) DO NOTHING
      RETURNING id`;
    console.log(`queued ${queued.length}; run npm run lms:run to send them`);
  }
} finally {
  await closeDb();
}
