import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { activeCategories } from "@/lib/tickets/read";
import { canCreateTickets, PRIORITIES } from "@/lib/tickets/service";
import { createTicketAction } from "../actions";
import { button, ErrorNote, field } from "../ui";

// A ticket made by hand: a phone call, a walk-in, an email outside the
// inbox. The customer must already be in the CRM (found by email or phone).
// Team and assignee follow from the category and the ticket rules.
export default async function NewTicketPage({
  searchParams,
}: PageProps<"/tickets/new">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!(await canCreateTickets({ id: user.id, role: user.role })))
    redirect("/tickets?error=forbidden");
  const q = await searchParams;
  const error = Array.isArray(q.error) ? q.error[0] : q.error;
  const categories = await activeCategories();

  return (
    <section className="max-w-xl">
      <Link href="/tickets" className="text-ink-muted text-sm underline">
        Tickets
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New ticket</h1>
      <ErrorNote code={error} />
      <form action={createTicketAction} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Customer&apos;s email or phone
          <input name="contact" required maxLength={254} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Category
          <select
            name="category"
            required
            className={field}
            defaultValue="general"
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} ({c.teamName})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Subject
          <input name="subject" required maxLength={200} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Priority
          <select name="priority" className={field} defaultValue="normal">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Note (internal)
          <textarea name="note" rows={4} maxLength={5000} className={field} />
        </label>
        <button type="submit" className={`${button} self-start`}>
          Create ticket
        </button>
      </form>
    </section>
  );
}
