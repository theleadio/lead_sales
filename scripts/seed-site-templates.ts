// Inserts the starter funnel templates (see site-templates-data.ts). Safe to
// run again: a template whose name already exists is skipped.
//
//   node --env-file-if-exists=.env.local scripts/seed-site-templates.ts
//
// Needs DATABASE_URL.
import { closeDb, db } from "../lib/sql.ts";
import { TEMPLATES } from "./site-templates-data.ts";

try {
  const sql = db();
  for (const t of TEMPLATES) {
    const [have] = await sql`SELECT 1 FROM sales.site_template WHERE kind = 'funnel' AND name = ${t.name}`;
    if (have) {
      console.log(`seed-site-templates: "${t.name}" exists, skipped`);
      continue;
    }
    await sql`
      INSERT INTO sales.site_template (kind, name, payload)
      VALUES ('funnel', ${t.name}, ${sql.json({ steps: t.steps } as never)})`;
    console.log(`seed-site-templates: "${t.name}" added`);
  }
} catch (e) {
  console.error(`seed-site-templates: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
