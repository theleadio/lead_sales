// Which migration files still need applying, in order. Pure, so it is tested
// without a database (tests/migrations.test.ts). Files are NNN_name.sql and
// run in name order; a file already in sales.schema_migration is skipped.
export const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/;

export function pendingMigrations(
  files: string[],
  applied: Iterable<string>,
): string[] {
  const done = new Set(applied);
  const bad = files.filter(
    (f) => f.endsWith(".sql") && !MIGRATION_FILE.test(f),
  );
  if (bad.length)
    throw new Error(
      `migration files must be named NNN_name.sql: ${bad.join(", ")}`,
    );
  return files.filter((f) => MIGRATION_FILE.test(f) && !done.has(f)).sort();
}

// The guard rail for ground rule 3: a lead_sales migration may create or
// alter tables only in the `sales` schema. Crude on purpose (a text check,
// not a SQL parser): it catches the easy mistake of an unqualified or
// public.* table, and a reviewer catches the rest.
export function outsideSalesSchema(sqlText: string): string[] {
  const stripped = sqlText.replace(/--.*$/gm, "");
  const hits: string[] = [];
  const re =
    /\b(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TYPE|FUNCTION|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+([^\s(;]+)/gi;
  for (const m of stripped.matchAll(re)) {
    const kind = m[1].toUpperCase();
    // An index or trigger is named bare; the table it is ON is checked by
    // the ON clause below.
    if (/INDEX|TRIGGER/.test(kind)) continue;
    if (!m[2].toLowerCase().startsWith("sales.")) hits.push(`${kind} ${m[2]}`);
  }
  for (const m of stripped.matchAll(
    /\bON\s+(?!CONFLICT\b)([a-z_][\w.]*)\s*\(/gi,
  ))
    if (!m[1].toLowerCase().startsWith("sales.")) hits.push(`ON ${m[1]}`);
  return hits;
}
