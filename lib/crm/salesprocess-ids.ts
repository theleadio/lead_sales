import { createHash } from "node:crypto";

// Copied from lead_crm lib/import/salesprocess-enrolments.ts (uuidV5,
// enrolmentIdFor). The SalesProcess import keys each enrolment it makes on
// the order id, so `enrolmentIdFor(salesprocess_payment.order_id)` finds them.
// Keep the namespace in step: changing it re-keys every imported row.
const NAMESPACE = "6f1d2c3a-4b5e-4f60-8a71-92b3c4d5e6f7";

function uuidV5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replaceAll("-", ""), "hex");
  const b = createHash("sha1").update(ns).update(name).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function enrolmentIdFor(orderId: string): string {
  return uuidV5(`sp-enrolment|${orderId}`);
}
