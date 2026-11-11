import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditAutomations } from "@/lib/automations/admin";

// The landing page after sign-in. Inbox, tickets and the help form were the
// first screens here; they moved to lead_crm (its migration 019, 11 Nov),
// where the Enquiries queue is now the one support queue.
export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">LEAD Sales</h1>
      <p className="text-ink-muted mt-3 text-sm">
        The inbox, enquiries (tickets) and the help form are in LEAD CRM: open
        Inbox or Enquiries there.
      </p>
      {user && canEditAutomations(user.role) && (
        <p className="mt-3 text-sm">
          <Link href="/automations" className="font-medium underline">
            Automations
          </Link>{" "}
          run here, and can start when an enquiry is created or a customer
          message arrives in the CRM.
        </p>
      )}
    </section>
  );
}
