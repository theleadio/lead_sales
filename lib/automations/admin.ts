import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { isUuid } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import { TicketError, type Actor } from "../tickets/service.ts";
import {
  conditionsSchema,
  stepsSchema,
  TRIGGERS,
  type Condition,
  type Step,
  type TriggerName,
} from "./model.ts";

// Making and changing automations. Who may (decided 4 Nov): management,
// super_admin and sales; not marketing. Every change is audited.

const EDITORS: readonly Role[] = ["super_admin", "management", "sales"];
export const canEditAutomations = (role: Role) => EDITORS.includes(role);

async function guard(actor: Actor, what: string) {
  if (canEditAutomations(actor.role)) return;
  await writeAudit({
    userId: actor.id,
    action: "permission_denied",
    entity: "automation",
    entityId: null,
    before: null,
    after: { what },
  });
  throw new TicketError(
    "forbidden",
    "Only management, super_admin and sales can change automations.",
  );
}

export type AutomationInput = {
  id?: string;
  name: string;
  trigger: TriggerName;
  conditions: Condition[];
  steps: Step[];
};

// Adds or replaces an automation's definition. Its on/off state is kept
// (a new one starts off). Runs already under way carry on from their next
// step number with the new steps.
export async function saveAutomation(
  actor: Actor,
  input: AutomationInput,
): Promise<string> {
  await guard(actor, "save automation");
  const name = input.name.trim();
  if (!name || name.length > 120)
    throw new TicketError("invalid", "A name of up to 120 characters.");
  if (!TRIGGERS.includes(input.trigger))
    throw new TicketError("invalid", "Unknown trigger.");
  const conds = conditionsSchema.safeParse(input.conditions);
  const steps = stepsSchema.safeParse(input.steps);
  if (!conds.success)
    throw new TicketError("invalid", "A condition is not valid.");
  if (!steps.success) throw new TicketError("invalid", "A step is not valid.");
  if (input.id && !isUuid(input.id))
    throw new TicketError("not_found", "No such automation.");

  return withTransaction(async () => {
    const sql = db();
    let id = input.id ?? null;
    let before: unknown = null;
    if (id) {
      const [a] =
        await sql`SELECT * FROM sales.automation WHERE id = ${id} FOR UPDATE`;
      if (!a) throw new TicketError("not_found", "No such automation.");
      before = a;
      await sql`
        UPDATE sales.automation
        SET name = ${name}, trigger = ${input.trigger},
            conditions = ${sql.json(conds.data as never)}, updated_at = now()
        WHERE id = ${id}`;
      await sql`DELETE FROM sales.automation_step WHERE automation_id = ${id}`;
    } else {
      const [a] = await sql`
        INSERT INTO sales.automation (created_by, name, trigger, conditions)
        VALUES (${actor.id}, ${name}, ${input.trigger}, ${sql.json(conds.data as never)})
        RETURNING id`;
      id = a.id as string;
    }
    for (const [i, s] of steps.data.entries())
      await sql`
        INSERT INTO sales.automation_step (automation_id, position, kind, settings)
        VALUES (${id}, ${i + 1}, ${s.kind}, ${sql.json(s.settings as never)})`;
    await writeAudit({
      userId: actor.id,
      action: input.id ? "update" : "create",
      entity: "automation",
      entityId: id,
      before,
      after: {
        name,
        trigger: input.trigger,
        conditions: conds.data,
        steps: steps.data,
      },
    });
    return id as string;
  });
}

// The kill switch. Off: no new runs, and waiting runs are held until it is
// on again.
export async function setAutomationActive(
  actor: Actor,
  id: string,
  active: boolean,
) {
  await guard(actor, active ? "switch on" : "switch off");
  if (!isUuid(id)) throw new TicketError("not_found", "No such automation.");
  const rows = await db()`
    UPDATE sales.automation
    SET active = ${active}, updated_at = now(),
        active_since = CASE WHEN ${active} THEN clock_timestamp() ELSE active_since END
    WHERE id = ${id} AND active <> ${active} RETURNING id`;
  if (rows.length)
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "automation",
      entityId: id,
      before: { active: !active },
      after: { active },
    });
}

export async function listAutomations() {
  const rows = await db()`
    SELECT a.id, a.name, a.trigger, a.active, a.updated_at,
           (SELECT count(*)::int FROM sales.automation_step s WHERE s.automation_id = a.id) AS steps,
           (SELECT count(*)::int FROM sales.automation_run r
            WHERE r.automation_id = a.id AND r.status IN ('running','waiting')) AS in_progress,
           (SELECT count(*)::int FROM sales.automation_run r
            WHERE r.automation_id = a.id AND r.status = 'failed') AS failed
    FROM sales.automation a ORDER BY a.name`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    trigger: r.trigger as TriggerName,
    active: r.active as boolean,
    updatedAt: r.updated_at as Date,
    steps: r.steps as number,
    inProgress: r.in_progress as number,
    failed: r.failed as number,
  }));
}

export async function automationDetail(id: string) {
  if (!isUuid(id)) return null;
  const sql = db();
  const [a] = await sql`SELECT * FROM sales.automation WHERE id = ${id}`;
  if (!a) return null;
  const [steps, runs] = await Promise.all([
    sql`SELECT position, kind, settings FROM sales.automation_step
        WHERE automation_id = ${id} ORDER BY position`,
    sql`
      SELECT r.id, r.status, r.next_step, r.next_run_at, r.last_error, r.created_at,
             p.full_name AS person_name,
             (SELECT json_agg(json_build_object('at', l.at, 'position', l.position,
                       'outcome', l.outcome, 'detail', l.detail) ORDER BY l.at)
              FROM sales.automation_log l WHERE l.run_id = r.id) AS log
      FROM sales.automation_run r JOIN person p ON p.id = r.person_id
      WHERE r.automation_id = ${id}
      ORDER BY r.created_at DESC LIMIT 50`,
  ]);
  return {
    id: a.id as string,
    name: a.name as string,
    trigger: a.trigger as TriggerName,
    active: a.active as boolean,
    conditions: a.conditions as Condition[],
    steps: steps.map((s) => ({ kind: s.kind, settings: s.settings }) as Step),
    runs: runs.map((r) => ({
      id: r.id as string,
      status: r.status as string,
      nextStep: r.next_step as number,
      nextRunAt: r.next_run_at as Date,
      lastError: r.last_error as string | null,
      createdAt: r.created_at as Date,
      personName: r.person_name as string,
      log: (r.log ?? []) as {
        at: string;
        position: number | null;
        outcome: string;
        detail: string | null;
      }[],
    })),
  };
}
