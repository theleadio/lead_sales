// One automations cycle: start runs for what happened since the last cycle,
// then work every due run. Runs every 5 minutes from
// .github/workflows/schedule.yml.
//
//   npm run automations:run
//
// Needs DATABASE_URL. Email goes through Resend when RESEND_API_KEY and
// EMAIL_FROM are set; WhatsApp has no sender yet. A send step with no
// sender fails its run with "not connected" (shown in the run log).
// Prints counts only.
import { runDue } from "../lib/automations/run.ts";
import { watchTriggers } from "../lib/automations/watch.ts";
import { resendFromEnv } from "../lib/email/resend.ts";
import { closeDb } from "../lib/sql.ts";

try {
  const started = await watchTriggers();
  const r = await runDue({ email: resendFromEnv() });
  console.log(`automations: started ${started} ${JSON.stringify(r)}`);
} catch (e) {
  // The message only: a database error's detail can hold an email or phone,
  // and Actions logs may be public.
  console.error(`automations: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
