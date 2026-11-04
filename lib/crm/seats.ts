import { db } from "../sql.ts";

// Copied from lead_crm (lib/classes/seats.ts, lib/payments/service.ts),
// spec §12.1. The database (migration 006) is the authority on seats; these
// let a writer refuse politely before the trigger refuses hard. Keep in step.

export const SEAT_STATUSES = [
  "reserved",
  "payment_pending",
  "confirmed",
  "onboarded",
  "attended",
  "completed",
];

// §9.12: money cannot be recorded against an enrolment in one of these.
export const BLOCKED_STATUSES = ["cancelled", "refunded", "transferred"];

// A cancelled or completed class is exempt from the seat guard, as in 006.
export const SEAT_GUARD_EXEMPT = ["cancelled", "completed"];

export function holdsSeat(status: string): boolean {
  return SEAT_STATUSES.includes(status);
}

// Migration 006 raises `no_seats` on a write that would oversell.
export function isNoSeats(e: unknown): boolean {
  return Boolean((e as { message?: string }).message?.includes("no_seats"));
}

export async function seatsTaken(classId: string): Promise<number> {
  const [row] = await db()`SELECT class_seats_taken(${classId}) AS taken`;
  return row.taken as number;
}
