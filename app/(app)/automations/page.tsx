import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditAutomations, listAutomations } from "@/lib/automations/admin";
import { TRIGGER_LABEL } from "@/lib/automations/model";
import { RowLink } from "../row-link";
import { Badge, button, EmptyState, PageHeader, table as t } from "../ui";
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
  if (!canEditAutomations(user.role)) redirect("/home");
  const q = await searchParams;
  const result = Array.isArray(q.result) ? q.result[0] : q.result;
  const automations = await listAutomations();

  return (
    <section className="max-w-5xl">
      <PageHeader
        title="Automations"
        lede={
          <>
            &ldquo;When this happens, do that.&rdquo; Switch one off to stop
            new runs and hold the ones waiting.
          </>
        }
        action={
          <Link href="/automations/new" className={button}>
            New automation
          </Link>
        }
      />
      <ResultNote code={result} />

      {automations.length === 0 ? (
        <EmptyState title="No automations yet">
          Start with a new-lead follow-up: tag the lead and give sales a task.
        </EmptyState>
      ) : (
        <div className={`${t.wrap} mt-6`}>
          <table className={t.table}>
            <thead>
              <tr>
                <th className={t.th}>Name</th>
                <th className={t.th}>When</th>
                <th className={`${t.th} text-right`}>Steps</th>
                <th className={`${t.th} text-right`}>In progress</th>
                <th className={`${t.th} text-right`}>Failed</th>
                <th className={t.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <RowLink key={a.id} href={`/automations/${a.id}`} className={t.row}>
                  <td className={t.td}>
                    <Link
                      href={`/automations/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                  </td>
                  <td className={t.td}>{TRIGGER_LABEL[a.trigger] ?? a.trigger}</td>
                  <td className={`${t.td} ${t.num}`}>{a.steps}</td>
                  <td className={`${t.td} ${t.num}`}>{a.inProgress}</td>
                  <td
                    className={`${t.td} ${t.num} ${a.failed ? "text-danger font-semibold" : ""}`}
                  >
                    {a.failed}
                  </td>
                  <td className={t.td}>
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
                      <Badge tone={a.active ? "green" : "grey"}>
                        {a.active ? "On" : "Off"}
                      </Badge>
                      <button
                        type="submit"
                        className="text-ink-muted hover:text-ink hover:bg-surface cursor-pointer rounded-md px-2 py-1 text-xs"
                      >
                        {a.active ? "Switch off" : "Switch on"}
                      </button>
                    </form>
                  </td>
                </RowLink>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
