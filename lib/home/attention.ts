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

// The same count, with the automation that has the most of them.
export async function failedRuns(): Promise<{ count: number; top: string | null }> {
  const rows = await db()`
    SELECT a.name, count(*)::int AS n
    FROM sales.automation_run r JOIN sales.automation a ON a.id = r.automation_id
    WHERE r.status = 'failed'
    GROUP BY a.name ORDER BY n DESC, a.name`;
  return {
    count: rows.reduce((t, r) => t + (r.n as number), 0),
    top: (rows[0]?.name as string | undefined) ?? null,
  };
}

// People a campaign reached who then used an unsubscribe link (at any time
// after their email went out; the link doesn't say which email it came from).
export async function unsubscribedAfter(campaignId: string): Promise<number> {
  const [r] = await db()`
    SELECT count(DISTINCT s.person_id)::int AS n
    FROM sales.email_send s
    JOIN consent c ON c.person_id = s.person_id
      AND c.purpose = 'marketing_email' AND NOT c.is_granted
      AND c.source = 'unsubscribe_link' AND c.recorded_at >= s.sent_at
    WHERE s.campaign_id = ${campaignId} AND s.status = 'sent'`;
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
