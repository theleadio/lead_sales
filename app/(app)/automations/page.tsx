import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditAutomations, listAutomations } from "@/lib/automations/admin";
import { TRIGGER_LABEL } from "@/lib/automations/model";
import { button } from "../tickets/ui";
import { toggleAutomationAction } from "./actions";
import { ResultNote } from "./shared";

// Automations (spec §1): the rules that run by themselves. New ones start
// switched off. Only management, super_admin and sales may see and change
// them (decided 4 Nov).
export default async function AutomationsPage({
  searchParams,
}: PageProps<"/automations">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditAutomations(user.role)) redirect("/inbox");
  const q = await searchParams;
  const result = Array.isArray(q.result) ? q.result[0] : q.result;
  const automations = await listAutomations();

  return (
    <section className="max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automations</h1>
        <Link href="/automations/new" className={button}>
          New automation
        </Link>
      </div>
      <p className="text-ink-muted mt-1 text-sm">
        &ldquo;When this happens, do that.&rdquo; Switch one off to stop new
        runs and hold the ones waiting.
      </p>
      <ResultNote code={result} />

      {automations.length === 0 ? (
        <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
          <p className="font-medium">No automations yet</p>
          <p className="text-ink-muted mt-1 text-sm">
            Start with a new-lead follow-up: tag the lead and give sales a task.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Steps</th>
                <th className="py-2 pr-4 font-medium">In progress</th>
                <th className="py-2 pr-4 font-medium">Failed</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <tr key={a.id} className="border-line border-t">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/automations/${a.id}`}
                      className="font-medium underline"
                    >
                      {a.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {TRIGGER_LABEL[a.trigger] ?? a.trigger}
                  </td>
                  <td className="py-2 pr-4">{a.steps}</td>
                  <td className="py-2 pr-4">{a.inProgress}</td>
                  <td
                    className={`py-2 pr-4 ${a.failed ? "text-danger font-medium" : ""}`}
                  >
                    {a.failed}
                  </td>
                  <td className="py-2">
                    <form
                      action={toggleAutomationAction}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="id" value={a.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={a.active ? "off" : "on"}
                      />
                      <input type="hidden" name="from" value="list" />
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.active ? "bg-lead-blue/50" : "bg-surface-muted text-ink-muted"}`}
                      >
                        {a.active ? "On" : "Off"}
                      </span>
                      <button
                        type="submit"
                        className="text-ink-muted cursor-pointer text-xs underline"
                      >
                        {a.active ? "Switch off" : "Switch on"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
