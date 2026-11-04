import { db } from "../sql.ts";

// Copied from lead_crm (lib/people/service.ts, lib/people/duplicate-review.ts).
// Keep in step.

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Tasks a system writer creates go to the duty super_admin (spec O37), so
// they show on someone's Home; null only with no active super_admin.
export async function dutySuperAdmin(): Promise<string | null> {
  const [row] = await db()`
    SELECT id FROM app_user
    WHERE role_code = 'super_admin' AND is_active
    ORDER BY created_at, id
    LIMIT 1`;
  return row?.id ?? null;
}
