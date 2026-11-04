// Tries again every Meta lead the webhook couldn't save yet (Graph API
// down, token expired, …), after its wait. Runs every 5 minutes from
// .github/workflows/schedule.yml.
//
//   npm run meta:run
//
// Needs DATABASE_URL and META_PAGE_ACCESS_TOKEN (META_GRAPH_VERSION
// optional). Prints counts only, never a lead's answers.
import { metaDepsFromEnv, runMetaQueue } from "../lib/meta/webhook.ts";
import { closeDb } from "../lib/sql.ts";

try {
  const deps = metaDepsFromEnv();
  if (!deps) {
    console.error("meta: META_PAGE_ACCESS_TOKEN is not set");
    process.exitCode = 1;
  } else {
    const r = await runMetaQueue(deps);
    console.log(`meta: ${JSON.stringify(r)}`);
    // Red only for a lead that ran out of tries (marketing have a task).
    if (r.lost > 0) process.exitCode = 1;
  }
} catch (e) {
  // The message only: a database error's detail can hold an email or phone,
  // and Actions logs may be public.
  console.error(`meta: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
