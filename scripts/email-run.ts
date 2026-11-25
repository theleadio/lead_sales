// One email marketing cycle: send the next batches of queued campaign emails
// through Resend. Runs every 5 minutes from .github/workflows/schedule.yml.
//
//   npm run email:run
//
// Needs DATABASE_URL, RESEND_API_KEY, EMAIL_FROM, APP_BASE_URL (the public
// address of this app, for the unsubscribe link) and EMAIL_UNSUBSCRIBE_SECRET
// (signs those links). Without them nothing is sent. Prints counts only.
import {
  mailConfigFromEnv,
  processEmailQueue,
} from "../lib/email/marketing.ts";
import { closeDb } from "../lib/sql.ts";

try {
  const cfg = mailConfigFromEnv();
  if (!cfg) console.log("email: not configured, nothing sent");
  else console.log(`email: ${JSON.stringify(await processEmailQueue(cfg))}`);
} catch (e) {
  // The message only: a database error's detail can hold an email address,
  // and Actions logs may be public.
  console.error(`email: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
