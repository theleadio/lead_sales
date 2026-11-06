import { db, withTransaction } from "../sql.ts";
import {
  conditionsHold,
  conditionsSchema,
  CRM_TRIGGERS,
  type Facts,
  type TriggerName,
} from "./model.ts";

// The trigger watcher (automations spec §3): reads what happened since the
// last run and starts one run per active automation per cause. It only
// READS the CRM's event_outbox: the CRM's own worker takes those rows, and
// a read leaves them as they are.
//
// Each source has a cursor and is re-read with an overlap (a row can
// commit after a later one), and a run is unique per (automation, cause),
// so re-reading never starts a run twice. The first read of a source starts
// from now: older events never fire automations made later.

export const OVERLAP_MINUTES = 10;

type Cause = {
  trigger: TriggerName;
  at: Date; // when it happened
  sourceKey: string;
  personId: string;
  context: Record<string, unknown>;
  event: Record<string, unknown>;
};

// ---- Sources --------------------------------------------------------------------

// Rows of one source between the cursor (less the overlap) and now. The
// bound is kept as text: a JS Date would drop the microseconds and could
// miss a row in the same millisecond (see lib/lms/watch.ts).
async function readWindow<T>(
  name: string,
  read: (from: string, to: string) => Promise<T[]>,
): Promise<T[]> {
  const sql = db();
  const [{ now }] = await sql`SELECT clock_timestamp()::text AS now`;
  const [c] = await sql`
    SELECT read_until::text AS read_until FROM sales.automation_cursor
    WHERE name = ${name} FOR UPDATE`;
  if (!c) {
    await sql`
      INSERT INTO sales.automation_cursor (name, read_until)
      VALUES (${name}, ${now}::text::timestamptz)`;
    return [];
  }
  const rows = await read(c.read_until as string, now as string);
  await sql`
    UPDATE sales.automation_cursor SET read_until = ${now}::text::timestamptz
    WHERE name = ${name}`;
  return rows;
}

// CRM events, each resolved to the person (or people) it is about.
async function outboxCauses(triggers: Set<string>): Promise<Cause[]> {
  const sql = db();
  const wanted = [...triggers].filter((t) => t in CRM_TRIGGERS);
  const rows = await readWindow("outbox", (from, to) =>
    wanted.length === 0
      ? Promise.resolve([])
      : sql`
          SELECT id, type, aggregate_id, payload, created_at FROM event_outbox
          WHERE type = ANY(${wanted})
            AND created_at > ${from}::text::timestamptz
                             - make_interval(mins => ${OVERLAP_MINUTES})
            AND created_at <= ${to}::text::timestamptz
          ORDER BY created_at, id`,
  );
  const out: Cause[] = [];
  for (const r of rows) {
    const trigger = r.type as keyof typeof CRM_TRIGGERS;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const how = CRM_TRIGGERS[trigger];
    const agg = r.aggregate_id as string;
    const one = async (q: Promise<readonly Record<string, unknown>[]>) =>
      ((await q)[0] ?? null) as Record<string, string | null> | null;
    let people: { personId: string; extra: Record<string, unknown> }[] = [];
    if (how === "person") people = [{ personId: agg, extra: {} }];
    else if (how === "deal" || how === "deal_in_payload") {
      const dealId = how === "deal" ? agg : String(payload.dealId ?? "");
      const d = dealId
        ? await one(sql`SELECT person_id FROM deal WHERE id = ${dealId}`)
        : null;
      if (d?.person_id) people = [{ personId: d.person_id, extra: { dealId } }];
    } else if (how === "enrolment") {
      const e = await one(
        sql`SELECT person_id, class_id FROM enrolment WHERE id = ${agg}`,
      );
      if (e?.person_id)
        people = [
          {
            personId: e.person_id,
            extra: { enrolmentId: agg, classId: e.class_id },
          },
        ];
    } else if (how === "payment") {
      const e = await one(sql`
        SELECT e.id, e.person_id, e.class_id FROM payment p
        JOIN enrolment e ON e.id = p.enrolment_id WHERE p.id = ${agg}`);
      if (e?.person_id)
        people = [
          {
            personId: e.person_id,
            extra: { enrolmentId: e.id, classId: e.class_id, paymentId: agg },
          },
        ];
    } else if (how === "enrolments_in_payload") {
      const ids = Array.isArray(payload.enrolmentIds)
        ? (payload.enrolmentIds as unknown[]).map(String)
        : [];
      if (ids.length)
        people = (
          await sql`
            SELECT id, person_id FROM enrolment WHERE id = ANY(${ids}::uuid[])`
        ).map((e) => ({
          personId: e.person_id as string,
          extra: { enrolmentId: e.id, classId: agg },
        }));
    }
    for (const p of people)
      out.push({
        trigger,
        at: r.created_at as Date,
        sourceKey:
          people.length > 1
            ? `outbox:${r.id}:${p.extra.enrolmentId}`
            : `outbox:${r.id}`,
        personId: p.personId,
        context: { eventId: r.id, ...p.extra },
        event: payload,
      });
  }
  return out;
}

async function ticketCauses(): Promise<Cause[]> {
  const sql = db();
  const rows = await readWindow(
    "ticket",
    (from, to) => sql`
    SELECT t.id, t.person_id, t.category, t.source_channel, t.number, t.created_at, tm.code AS team
    FROM sales.ticket t JOIN sales.team tm ON tm.id = t.team_id
    WHERE t.created_at > ${from}::text::timestamptz - make_interval(mins => ${OVERLAP_MINUTES})
      AND t.created_at <= ${to}::text::timestamptz`,
  );
  return rows.map((t) => ({
    trigger: "TicketCreated",
    at: t.created_at,
    sourceKey: `ticket:${t.id}`,
    personId: t.person_id,
    context: { ticketId: t.id },
    event: {
      category: t.category,
      channel: t.source_channel,
      team: t.team,
      number: t.number,
    },
  }));
}

async function messageCauses(): Promise<Cause[]> {
  const sql = db();
  const rows = await readWindow(
    "message",
    (from, to) => sql`
    SELECT id, person_id, channel, conversation_id, created_at FROM sales.message
    WHERE direction = 'in'
      -- Copied-in history (lib/wati/history.ts) never starts a flow.
      AND NOT imported
      AND created_at > ${from}::text::timestamptz - make_interval(mins => ${OVERLAP_MINUTES})
      AND created_at <= ${to}::text::timestamptz`,
  );
  return rows.map((m) => ({
    trigger: "MessageReceived",
    at: m.created_at,
    sourceKey: `message:${m.id}`,
    personId: m.person_id,
    context: { conversationId: m.conversation_id, messageId: m.id },
    event: { channel: m.channel },
  }));
}

async function lmsCauses(): Promise<Cause[]> {
  const sql = db();
  const rows = await readWindow(
    "lms_account",
    (from, to) => sql`
    SELECT n.id, n.sent_at, e.id AS enrolment_id, e.person_id, e.class_id
    FROM sales.lms_notice n JOIN enrolment e ON e.id = n.ref_id
    WHERE n.kind = 'enrolment.confirmed' AND n.sent_at IS NOT NULL
      AND n.sent_at > ${from}::text::timestamptz - make_interval(mins => ${OVERLAP_MINUTES})
      AND n.sent_at <= ${to}::text::timestamptz`,
  );
  return rows.map((n) => ({
    trigger: "LmsAccountReady",
    at: n.sent_at,
    sourceKey: `lms:${n.id}`,
    personId: n.person_id,
    context: { enrolmentId: n.enrolment_id, classId: n.class_id },
    event: {},
  }));
}

// ---- Matching -------------------------------------------------------------------

async function factsFor(
  personId: string,
  event: Record<string, unknown>,
): Promise<Facts | null> {
  const sql = db();
  const [p] = await sql`
    SELECT preferred_language, email, coalesce(phone_e164, phone) AS phone
    FROM person WHERE id = ${personId} AND deleted_at IS NULL`;
  if (!p) return null;
  const tags = await sql`
    SELECT lower(t.name) AS name FROM person_tag pt JOIN tag t ON t.id = pt.tag_id
    WHERE pt.person_id = ${personId}`;
  return {
    preferredLanguage: p.preferred_language,
    tags: tags.map((t) => t.name as string),
    email: p.email,
    phone: p.phone,
    event,
  };
}

// One pass: read every source, start runs for active automations whose
// trigger fired and whose conditions hold. Returns how many runs started.
export async function watchTriggers(): Promise<number> {
  return withTransaction(async () => {
    const sql = db();
    const autos = await sql`
      SELECT id, trigger, conditions, active_since FROM sales.automation WHERE active`;
    const triggers = new Set(autos.map((a) => a.trigger as string));
    // Every source is read even with no automation for it, so its cursor
    // moves on: switching an automation on never fires it for old events.
    const causes = [
      ...(await outboxCauses(triggers)),
      ...(await ticketCauses()),
      ...(await messageCauses()),
      ...(await lmsCauses()),
    ];
    let started = 0;
    for (const c of causes) {
      const matching = autos.filter(
        (a) =>
          a.trigger === c.trigger &&
          a.active_since !== null &&
          c.at >= (a.active_since as Date),
      );
      if (matching.length === 0) continue;
      const facts = await factsFor(c.personId, c.event);
      if (!facts) continue;
      for (const a of matching) {
        const conds = conditionsSchema.safeParse(a.conditions);
        if (!conds.success || !conditionsHold(conds.data, facts)) continue;
        const [run] = await sql`
          INSERT INTO sales.automation_run (automation_id, person_id, source_key, context)
          VALUES (${a.id}, ${c.personId}, ${c.sourceKey},
                  ${sql.json({ trigger: c.trigger, ...c.context, event: c.event } as never)})
          ON CONFLICT (automation_id, source_key) DO NOTHING
          RETURNING id`;
        if (!run) continue;
        await sql`
          INSERT INTO sales.automation_log (run_id, outcome, detail)
          VALUES (${run.id}, 'started', ${`${c.trigger} (${c.sourceKey})`})`;
        started++;
      }
    }
    return started;
  });
}
