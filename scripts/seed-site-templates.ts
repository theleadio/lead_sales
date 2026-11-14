// Inserts the v2 starter funnel templates (site-templates-data.ts) and, on this
// run only, deletes old v1 data: funnel templates with a step whose
// project.version !== 2, and drafts whose project.version !== 2 (blank `{}`
// included; a missing draft is read as a blank page). Safe to run again.
//
//   node --env-file-if-exists=.env.local scripts/seed-site-templates.ts
//
// Needs DATABASE_URL. Local DB only: never point this at production.
import { closeDb, db } from "../lib/sql.ts";
import { TEMPLATES } from "./site-templates-data.ts";

export async function seedTemplates(log: (m: string) => void = () => {}) {
  const sql = db();
  const old = await sql`
    DELETE FROM sales.site_template
    WHERE kind = 'funnel' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(payload->'steps') s WHERE s->'project'->>'version' IS DISTINCT FROM '2')
    RETURNING name`;
  log(`seed-site-templates: ${old.count} v1 template(s) deleted`);
  const drafts = await sql`
    DELETE FROM sales.page_version WHERE status = 'draft' AND project->>'version' IS DISTINCT FROM '2'`;
  log(`seed-site-templates: ${drafts.count} v1 draft(s) deleted`);
  for (const t of TEMPLATES) {
    const payload = sql.json({ steps: t.steps } as never);
    const done = await sql`UPDATE sales.site_template SET payload = ${payload} WHERE kind = 'funnel' AND name = ${t.name}`;
    if (!done.count) await sql`INSERT INTO sales.site_template (kind, name, payload) VALUES ('funnel', ${t.name}, ${payload})`;
    log(`seed-site-templates: "${t.name}" ${done.count ? "updated" : "added"}`);
  }
}

if ((import.meta as { main?: boolean }).main) { // Node 24: true only when run directly
  try {
    await seedTemplates(console.log);
  } catch (e) {
    console.error(`seed-site-templates: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
