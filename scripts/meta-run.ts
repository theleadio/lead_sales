// Tries again every Meta lead the webhook couldn't save yet (Graph API
// down, token expired, …), after its wait. Run it on a schedule.
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
    if (r.failed + r.lost > 0) process.exitCode = 1;
  }
} finally {
  await closeDb();
}
