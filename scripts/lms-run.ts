// One CRM → LMS cycle: read CRM changes into sales.lms_notice, then send
// everything due. Runs every 5 minutes from .github/workflows/schedule.yml
// (decided 4 Nov: GitHub Actions).
//
//   npm run lms:run
//
// Needs DATABASE_URL, LMS_HANDOFF_ENABLED=true, LMS_WEBHOOK_URL and
// LMS_WEBHOOK_SECRET. Prints counts only.
import { drainLms } from "../lib/lms/drain.ts";
import { runWatch } from "../lib/lms/watch.ts";
import { closeDb } from "../lib/sql.ts";

try {
  const watched = await runWatch();
  const total = { sent: 0, skipped: 0, failed: 0, dead: 0 };
  for (;;) {
    const r = await drainLms();
    for (const k of Object.keys(total) as (keyof typeof total)[])
      total[k] += r[k];
    // A failed row waits out its backoff, so it isn't due again this run.
    if (r.sent + r.skipped + r.failed + r.dead === 0) break;
  }
  console.log(
    `lms: queued ${JSON.stringify(watched)} sent ${JSON.stringify(total)}`,
  );
  // Red only for a notice that ran out of tries: a retry waiting out its
  // backoff is normal, and a red run every 5 minutes would bury the real one.
  if (total.dead > 0) process.exitCode = 1;
} catch (e) {
  // The message only: a database error's detail can hold an email or phone,
  // and Actions logs may be public.
  console.error(`lms: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
