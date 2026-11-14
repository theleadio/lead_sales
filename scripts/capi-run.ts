// Sends the queued Meta Conversions API events (and queues new Purchase
// events from recent payments). Runs every 5 minutes from
// .github/workflows/schedule.yml.
//
// Needs DATABASE_URL, META_CAPI_TOKEN, META_PIXEL_ID; META_TEST_EVENT_CODE is
// optional. Prints counts only.
import { drainCapi } from "../lib/sites/capi.ts";
import { closeDb } from "../lib/sql.ts";

try {
  const r = await drainCapi(new Date());
  console.log(`capi: ${JSON.stringify(r)}`);
} catch (e) {
  // The message only: Actions logs may be public.
  console.error(`capi: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
