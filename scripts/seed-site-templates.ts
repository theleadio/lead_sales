// Inserts the starter funnel templates (see site-templates-data.ts). Safe to
// run again: a template whose name already exists is updated in place.
//
//   node --env-file-if-exists=.env.local scripts/seed-site-templates.ts
//
// Needs DATABASE_URL.
import { closeDb, db } from "../lib/sql.ts";
import { TEMPLATES } from "./site-templates-data.ts";

try {
  const sql = db();
  for (const t of TEMPLATES) {
    const payload = sql.json({ steps: t.steps } as never);
    const done = await sql`UPDATE sales.site_template SET payload = ${payload} WHERE kind = 'funnel' AND name = ${t.name}`;
    if (done.count) {
      console.log(`seed-site-templates: "${t.name}" updated`);
      continue;
    }
    await sql`INSERT INTO sales.site_template (kind, name, payload) VALUES ('funnel', ${t.name}, ${payload})`;
    console.log(`seed-site-templates: "${t.name}" added`);
  }
} catch (e) {
  console.error(`seed-site-templates: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
