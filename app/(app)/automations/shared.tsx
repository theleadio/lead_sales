import { TRIGGER_LABEL, TRIGGERS } from "@/lib/automations/model";
import { Badge, type Tone } from "../ui";

// Pieces shared by the automation pages.

export const triggerOptions = TRIGGERS.map((t) => ({
  value: t,
  label: TRIGGER_LABEL[t],
}));

export const RESULTS: Record<string, { text: string; ok: boolean }> = {
  saved: { text: "Saved.", ok: true },
  retried: { text: "The run will try again within 5 minutes.", ok: true },
  invalid: {
    text: "That wasn't possible. Reload the page and try again.",
    ok: false,
  },
  forbidden: {
    text: "Only management, super_admin and sales can change automations.",
    ok: false,
  },
};

export function ResultNote({ code }: { code: string | undefined }) {
  const r = code ? RESULTS[code] : undefined;
  if (!r) return null;
  return (
    <p
      role={r.ok ? "status" : "alert"}
      className={`mt-4 rounded-xl border px-4 py-3 text-sm ${r.ok ? "border-line bg-surface-muted" : "border-danger/40 bg-danger/5 text-danger"}`}
    >
      {r.text}
    </p>
  );
}

export const RUN_STATUS: Record<string, string> = {
  running: "Running",
  waiting: "Waiting",
  done: "Finished",
  stopped: "Stopped",
  failed: "Failed",
};

export const runTone = (status: string): Tone =>
  status === "failed"
    ? "red"
    : status === "done"
      ? "green"
      : status === "stopped"
        ? "grey"
        : "blue";

export function RunPill({ status }: { status: string }) {
  return <Badge tone={runTone(status)}>{RUN_STATUS[status] ?? status}</Badge>;
}
