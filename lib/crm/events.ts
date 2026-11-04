import { db } from "../sql.ts";

// Copied from lead_crm lib/events/raise.ts and types.ts (spec §11.1), only
// the events lead_sales raises. The rows go to the CRM's event_outbox and the
// CRM's worker runs them, as if the CRM had raised them. Payload shapes must
// match the CRM's EventPayloads exactly. Keep in step.
export type EventPayloads = {
  LeadCaptured: {
    personId: string;
    dealId: string;
    formName: string;
    touchpointId: string;
  };
  ConsentChanged: { personId: string; purpose: string; isGranted: boolean };
};
export type EventType = keyof EventPayloads;

const AGGREGATE: Record<EventType, string> = {
  LeadCaptured: "person",
  ConsentChanged: "person",
};

export async function raiseEvent<T extends EventType>(
  type: T,
  aggregateId: string,
  payload: EventPayloads[T],
  actorId: string | null,
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_by)
    VALUES (${type}, ${AGGREGATE[type]}, ${aggregateId},
            ${sql.json(payload as never)}, ${actorId})`;
}
