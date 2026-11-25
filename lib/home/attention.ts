import type { Role } from "../auth/roles";
import { canEditAutomations } from "../automations/admin";
import { canSeePayments, paymentSummary } from "../payments/list";
import { canUseSocial, listNeedsAction } from "../social/social";
import { db } from "../sql";

type Viewer = { id: string; role: Role };

// Failed automation runs nobody has retried yet.
export async function failedRunCount(): Promise<number> {
  const [r] = await db()`
    SELECT count(*)::int AS n FROM sales.automation_run WHERE status = 'failed'`;
  return r.n as number;
}

// The red numbers in the menu: things waiting for a person, per screen, for
// the screens this person can open. Each count is its own query, and a count
// that fails shows nothing rather than breaking the menu.
export async function attentionCount(
  viewer: Viewer,
  href: string,
): Promise<number> {
  try {
    if (href === "/payments" && canSeePayments(viewer.role))
      return (await paymentSummary(viewer)).unmatchedCount;
    if (href === "/automations" && canEditAutomations(viewer.role))
      return await failedRunCount();
    if (href === "/social" && canUseSocial(viewer.role))
      return (await listNeedsAction()).length;
  } catch (e) {
    console.error(`attention count for ${href} failed`, e);
  }
  return 0;
}

// What the menu counts, so the layout only starts queries that can count.
export const COUNTED = ["/payments", "/automations", "/social"] as const;
