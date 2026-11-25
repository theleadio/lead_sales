// One social planner cycle: post the Facebook Page posts that are due.
// Runs every 5 minutes from .github/workflows/schedule.yml.
//
//   npm run social:run
//
// Needs DATABASE_URL, FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN (a Page access
// token that can publish; META_GRAPH_VERSION optional). Without them nothing
// is posted and due posts wait. Prints counts only.
import { facebookConfigFromEnv } from "../lib/social/facebook.ts";
import { processSocialQueue } from "../lib/social/social.ts";
import { closeDb } from "../lib/sql.ts";

try {
  const cfg = facebookConfigFromEnv();
  if (!cfg) console.log("social: Facebook not configured, nothing posted");
  else console.log(`social: ${JSON.stringify(await processSocialQueue(cfg))}`);
} catch (e) {
  // The message only: Actions logs may be public.
  console.error(`social: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
