import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { automationDetail, canEditAutomations } from "@/lib/automations/admin";
import { button, myt } from "../../tickets/ui";
import { retryRunAction, toggleAutomationAction } from "../actions";
import {
  AutomationEditor,
  type InitialCondition,
  type InitialStep,
} from "../editor";
import { ResultNote, RunPill, triggerOptions } from "../shared";

// One automation: its switch, its editor, and what its latest runs did.
export default async function AutomationPage({
  params,
  searchParams,
}: PageProps<"/automations/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditAutomations(user.role)) redirect("/inbox");
  const { id } = await params;
  const a = await automationDetail(id);
  if (!a) notFound();
  const q = await searchParams;
  const result = Array.isArray(q.result) ? q.result[0] : q.result;

  return (
    <section className="max-w-3xl">
      <Link href="/automations" className="text-ink-muted text-sm underline">
        Automations
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{a.name}</h1>
        <form
          action={toggleAutomationAction}
          className="flex items-center gap-2"
        >
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="active" value={a.active ? "off" : "on"} />
          <input type="hidden" name="from" value="detail" />
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.active ? "bg-lead-blue/50" : "bg-surface-muted text-ink-muted"}`}
          >
            {a.active ? "On" : "Off"}
          </span>
          <button
            type="submit"
            className="border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-1.5 text-sm"
          >
            {a.active ? "Switch off" : "Switch on"}
          </button>
        </form>
      </div>
      <ResultNote code={result} />

      <AutomationEditor
        id={a.id}
        name={a.name}
        trigger={a.trigger}
        conditions={a.conditions as InitialCondition[]}
        steps={a.steps as InitialStep[]}
        triggers={triggerOptions}
      />

      <h2 className="mt-12 text-lg font-semibold">Latest runs</h2>
      {a.runs.length === 0 ? (
        <p className="text-ink-muted mt-2 text-sm">
          No runs yet.{" "}
          {a.active
            ? "It starts the next time its trigger happens."
            : "It is switched off."}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {a.runs.map((r) => (
            <li
              key={r.id}
              className="border-line rounded-xl border p-4 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.personName}</span>
                <RunPill status={r.status} />
                <span className="text-ink-muted text-xs">
                  started {myt(new Date(r.createdAt))}
                </span>
                {r.status === "waiting" && (
                  <span className="text-ink-muted text-xs">
                    next step {myt(new Date(r.nextRunAt))}
                  </span>
                )}
                {r.status === "failed" && (
                  <form action={retryRunAction} className="ml-auto">
                    <input type="hidden" name="automationId" value={a.id} />
                    <input type="hidden" name="runId" value={r.id} />
                    <button type="submit" className={button}>
                      Run again
                    </button>
                  </form>
                )}
              </div>
              {r.lastError && r.status === "failed" && (
                <p className="text-danger mt-2 text-xs">{r.lastError}</p>
              )}
              <ol className="text-ink-muted mt-2 flex flex-col gap-0.5 text-xs">
                {r.log.map((l, i) => (
                  <li key={i}>
                    {myt(new Date(l.at))} ·{" "}
                    {l.position ? `step ${l.position}` : "run"} · {l.outcome}
                    {l.detail ? `: ${l.detail}` : ""}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
