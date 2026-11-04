import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { outsideSalesSchema, pendingMigrations } from "../lib/migrations.ts";

test("pending migrations run in name order and skip applied ones", () => {
  assert.deepEqual(
    pendingMigrations(
      ["002_b.sql", "000_sales_schema.sql", "001_a.sql", "README.md"],
      ["000_sales_schema.sql"],
    ),
    ["001_a.sql", "002_b.sql"],
  );
});

test("a badly named .sql file is refused, not silently skipped", () => {
  assert.throws(() => pendingMigrations(["1_oops.sql"], []), /NNN_name\.sql/);
});

test("the schema guard passes sales.* and flags anything else", () => {
  assert.deepEqual(
    outsideSalesSchema(`
      CREATE TABLE sales.ticket (id uuid);
      CREATE UNIQUE INDEX ticket_uq ON sales.ticket (id);
      INSERT INTO sales.ticket VALUES (gen_random_uuid()) ON CONFLICT (id) DO NOTHING;
      -- CREATE TABLE person (commented out, ignored)
    `),
    [],
  );
  assert.deepEqual(
    outsideSalesSchema(`
      CREATE TABLE ticket (id uuid);
      ALTER TABLE public.person ADD COLUMN x int;
      CREATE INDEX person_x ON person (x);
    `),
    ["CREATE TABLE ticket", "ALTER TABLE public.person", "ON person"],
  );
});

test("every shipped migration stays inside the sales schema", async () => {
  const dir = join(import.meta.dirname, "..", "db", "migrations");
  const file = "000_sales_schema.sql";
  assert.deepEqual(
    outsideSalesSchema(await readFile(join(dir, file), "utf8")),
    [],
  );
});
