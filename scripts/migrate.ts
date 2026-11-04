// Applies db/migrations/NNN_*.sql that aren't in sales.schema_migration yet,
// in name order, each in its own transaction with its ledger row.
//
//   npm run db:migrate              dry run: lists what would run
//   npm run db:migrate -- --apply   apply
//
// Refuses a file that creates or alters anything outside the `sales`
// schema (lib/migrations.ts). Run against STAGING first, never straight at
// production.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { outsideSalesSchema, pendingMigrations } from "../lib/migrations.ts";
import { closeDb, db } from "../lib/sql.ts";

const apply = process.argv.includes("--apply");
const dir = join(import.meta.dirname, "..", "db", "migrations");

try {
  const sql = db();
  await sql`CREATE SCHEMA IF NOT EXISTS sales`;
  await sql`CREATE TABLE IF NOT EXISTS sales.schema_migration (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = (await sql`SELECT name FROM sales.schema_migration`).map(
    (r) => r.name as string,
  );
  const todo = pendingMigrations(await readdir(dir), applied);
  if (!todo.length) console.log("nothing to apply");
  for (const file of todo) {
    const text = await readFile(join(dir, file), "utf8");
    const outside = outsideSalesSchema(text);
    if (outside.length)
      throw new Error(
        `${file} touches outside the sales schema: ${outside.join("; ")}`,
      );
    if (!apply) {
      console.log(`would apply ${file}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO sales.schema_migration (name) VALUES (${file})`;
    });
    console.log(`applied ${file}`);
  }
  if (!apply && todo.length) console.log("dry run: add --apply to run them");
} finally {
  await closeDb();
}
