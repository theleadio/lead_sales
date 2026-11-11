// Small shared pieces for the signed-in screens (kept from the ticket
// screens, which moved to lead_crm with its migration 019).

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

export const field =
  "border-line bg-surface rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring";
export const button =
  "bg-action text-action-ink cursor-pointer rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
