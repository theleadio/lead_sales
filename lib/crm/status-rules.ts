// Copied from lead_crm lib/enrolments/status-rules.ts (spec §12.4): which
// enrolment status may move to which. Keep in step with the CRM.
export const ENROLMENT_STATUSES = [
  "reserved",
  "payment_pending",
  "waitlisted",
  "confirmed",
  "onboarded",
  "attended",
  "completed",
  "no_show",
  "transferred",
  "cancelled",
  "refunded",
] as const;

export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

const NEXT: Record<EnrolmentStatus, EnrolmentStatus[]> = {
  reserved: ["payment_pending", "confirmed", "waitlisted", "cancelled"],
  payment_pending: ["confirmed", "cancelled"],
  waitlisted: ["reserved"],
  confirmed: ["onboarded", "transferred", "cancelled"],
  onboarded: ["attended", "cancelled", "no_show"],
  attended: ["completed"],
  completed: [],
  no_show: [],
  transferred: [],
  cancelled: ["refunded"],
  refunded: [],
};

// `transferred` is only reachable through the transfer action, never a plain
// status move (lead_crm ACTION_ONLY).
const ACTION_ONLY: EnrolmentStatus[] = ["transferred"];

export function canChangeTo(from: string, to: string): boolean {
  return (NEXT[from as EnrolmentStatus] ?? [])
    .filter((s) => !ACTION_ONLY.includes(s))
    .includes(to as EnrolmentStatus);
}
