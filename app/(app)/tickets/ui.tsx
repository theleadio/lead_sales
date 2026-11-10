// Small shared pieces for the ticket screens.

export const ERRORS: Record<string, string> = {
  invalid: "That change isn't allowed. Check the fields and try again.",
  not_found: "That ticket doesn't exist, or you don't have access to it.",
  forbidden: "You don't have permission to do that.",
  send_failed: "WhatsApp did not accept the message. Try again, or check the WATI connection.",
  no_person:
    "No one in the CRM has that email or phone. Add them in the CRM first.",
  many_people:
    "More than one person in the CRM matches. Use their email instead, or merge the duplicates in the CRM.",
};

export function ErrorNote({ code }: { code: string | undefined }) {
  const text = code ? ERRORS[code] : undefined;
  if (!text) return null;
  return (
    <p
      role="alert"
      className="border-danger/40 bg-danger/5 text-danger mt-4 rounded-xl border px-4 py-3 text-sm"
    >
      {text}
    </p>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  open: "Open",
  waiting_customer: "Waiting on customer",
  resolved: "Resolved",
  closed: "Closed",
};

// Times are shown in Malaysia time, where the office is.
const fmt = new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
export const myt = (d: Date) => fmt.format(d);

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "new"
      ? "bg-lead-yellow text-ink"
      : status === "resolved" || status === "closed"
        ? "bg-surface-muted text-ink-muted"
        : "bg-lead-blue/50 text-ink";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const field =
  "border-line bg-surface rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring";
export const button =
  "bg-action text-action-ink cursor-pointer rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
