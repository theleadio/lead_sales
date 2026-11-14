import { z } from "zod";
import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { db, withTransaction } from "../sql.ts";
import { guard } from "./admin.ts";
import { purge } from "./purge.ts";

// Site-wide {{key}} values. Published html keeps the tokens; serve substitutes.
type Viewer = { id: string; role: Role };
export type CustomValue = { key: string; label: string; value: string; version: number; updatedAt: Date };

const valueSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Key: lowercase letters, digits and _, 2-41 characters, starting with a letter"),
  label: z.string().trim().min(1).max(120),
  value: z.string().max(2000),
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Unknown keys become empty text; values are HTML-escaped.
export function applyValues(html: string, values: Map<string, string>): string {
  return html.replace(/\{\{([a-z][a-z0-9_]{1,40})\}\}/g, (_, k: string) => esc(values.get(k) ?? ""));
}

// No permission check: used by serve and preview, which have their own.
export async function loadValues(): Promise<Map<string, string>> {
  const rows = await db()`SELECT key, value FROM sales.custom_value`;
  return new Map(rows.map((r) => [r.key as string, r.value as string]));
}

export async function listCustomValues(viewer: Viewer): Promise<CustomValue[]> {
  await guard(viewer, "view custom values", false);
  const rows = await db()`SELECT key, label, value, version, updated_at FROM sales.custom_value ORDER BY label`;
  return rows.map((r) => ({
    key: r.key as string, label: r.label as string, value: r.value as string, version: r.version as number, updatedAt: r.updated_at as Date,
  }));
}

// version null = create (conflict if the key exists); else update at that version.
export async function saveCustomValue(
  viewer: Viewer,
  input: { key: string; label: string; value: string },
  version: number | null,
): Promise<{ kind: "ok"; version: number } | { kind: "conflict" }> {
  await guard(viewer, "edit custom values", true);
  const v = valueSchema.parse(input);
  const r = await withTransaction(async () => {
    const sql = db();
    const [old] = await sql`SELECT label, value FROM sales.custom_value WHERE key = ${v.key}`;
    const [row] =
      version === null
        ? await sql`
            INSERT INTO sales.custom_value (key, label, value, updated_by) VALUES (${v.key}, ${v.label}, ${v.value}, ${viewer.id})
            ON CONFLICT (key) DO NOTHING RETURNING version`
        : await sql`
            UPDATE sales.custom_value SET label = ${v.label}, value = ${v.value}, updated_by = ${viewer.id}, updated_at = now(), version = version + 1
            WHERE key = ${v.key} AND version = ${version} RETURNING version`;
    if (!row) return null;
    await writeAudit({
      userId: viewer.id,
      action: old ? "update" : "create",
      entity: "custom_value",
      entityId: null,
      before: old ? { key: v.key, label: old.label, value: old.value } : null,
      after: { key: v.key, label: v.label, value: v.value },
    });
    return row.version as number;
  });
  if (r === null) return { kind: "conflict" };
  // Every live page may use the token: purge them all.
  const live = await db()`SELECT id FROM sales.site_page WHERE active_version_id IS NOT NULL`;
  await purge(live.map((p) => p.id as string));
  return { kind: "ok", version: r };
}
