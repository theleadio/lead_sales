import { writeAudit } from "../audit.ts";
import { dutySuperAdmin } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import { replyDueAt } from "../tickets/deadline.ts";
import { loadHolidays } from "../tickets/service.ts";
import {
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  stepSchema,
  WAIT_MS,
  type Step,
} from "./model.ts";

// The run worker (automations spec §3 "Waits"): picks up runs that are due,
// whose automation is switched on, and works through their steps until a
// wait, the end, a stop, or a failure. Every step's outcome is logged in
// sales.automation_log.
//
// Sending: email and WhatsApp go through a Sender. None is connected yet
// (email provider and WATI templates are open questions), so a send step
// fails the run with "not connected" and the run log says so. Before any
// sender is called the engine checks:
//   - marketing consent, for a marketing message (service messages to
//     students go without it, decided 4 Nov)
//   - a contact to send to (no email = the email step is skipped)
//   - that this exact message (run + step) was not sent already

export type SendRequest = {
  channel: "email" | "whatsapp";
  template: string;
  personId: string;
  to: string;
  language: "en" | "zh";
  context: Record<string, unknown>;
  // Unique per run and step: a sender records it as the message's
  // external id, so a retry can't send twice.
  idempotencyKey: string;
};
export type Sender = (req: SendRequest) => Promise<void>;
export type Senders = Partial<Record<"email" | "whatsapp", Sender>>;

class Final extends Error {}

type Run = {
  id: string;
  automation_id: string;
  person_id: string;
  context: Record<string, unknown>;
  next_step: number;
  attempts: number;
  created_at: Date;
};

type Outcome =
  | { kind: "next"; log: "done" | "skipped"; detail: string }
  | { kind: "wait"; until: Date; detail: string }
  | { kind: "stop"; detail: string };

// ---- Steps ----------------------------------------------------------------------

async function tagId(name: string, create: boolean): Promise<string | null> {
  const sql = db();
  const [t] = await sql`SELECT id FROM tag WHERE lower(name) = lower(${name})`;
  if (t) return t.id as string;
  if (!create) return null;
  const [n] = await sql`
    INSERT INTO tag (name) VALUES (${name})
    ON CONFLICT (lower(name)) DO UPDATE SET name = tag.name
    RETURNING id`;
  return n.id as string;
}

async function runStep(
  run: Run,
  step: Step,
  position: number,
  senders: Senders,
): Promise<Outcome> {
  const sql = db();
  const ctx = run.context;
  switch (step.kind) {
    case "add_tag": {
      const id = await tagId(step.settings.tag, true);
      const added = await sql`
        INSERT INTO person_tag (person_id, tag_id) VALUES (${run.person_id}, ${id})
        ON CONFLICT DO NOTHING RETURNING tag_id`;
      return {
        kind: "next",
        log: added.length ? "done" : "skipped",
        detail: added.length
          ? `Tagged "${step.settings.tag}"`
          : `Already tagged "${step.settings.tag}"`,
      };
    }
    case "remove_tag": {
      const id = await tagId(step.settings.tag, false);
      const gone = id
        ? await sql`DELETE FROM person_tag WHERE person_id = ${run.person_id} AND tag_id = ${id} RETURNING tag_id`
        : [];
      return {
        kind: "next",
        log: gone.length ? "done" : "skipped",
        detail: gone.length
          ? `Removed "${step.settings.tag}"`
          : `Not tagged "${step.settings.tag}"`,
      };
    }
    case "create_task": {
      const s = step.settings;
      const dealId = typeof ctx.dealId === "string" ? ctx.dealId : null;
      let assignee: string | null = null;
      if (s.assignTo === "deal_owner" && dealId) {
        const [d] = await sql`
          SELECT d.owner_user_id FROM deal d JOIN app_user u ON u.id = d.owner_user_id
          WHERE d.id = ${dealId} AND u.is_active`;
        assignee = (d?.owner_user_id as string | undefined) ?? null;
      }
      assignee ??= await dutySuperAdmin();
      const due =
        "hours" in s.due
          ? new Date(Date.now() + s.due.hours * 3600_000)
          : replyDueAt(new Date(), await loadHolidays());
      await sql`
        INSERT INTO task (type, title, person_id, deal_id, enrolment_id,
                          assigned_user_id, due_at, notes, source_key)
        VALUES (${s.type}, ${s.title}, ${run.person_id}, ${dealId},
                ${typeof ctx.enrolmentId === "string" ? ctx.enrolmentId : null},
                ${assignee}, ${due}, ${"Created by an automation."},
                ${`automation:${run.id}:${position}`})
        ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;
      return { kind: "next", log: "done", detail: `Task "${s.title}"` };
    }
    case "wait":
      return {
        kind: "wait",
        until: new Date(Date.now() + WAIT_MS(step.settings)),
        detail:
          `Waiting ${step.settings.days ? `${step.settings.days} day(s) ` : ""}${step.settings.hours ? `${step.settings.hours} hour(s)` : ""}`.trim(),
      };
    case "stop_if_replied": {
      const [m] = await sql`
        SELECT 1 FROM sales.message
        WHERE person_id = ${run.person_id} AND direction = 'in'
          AND sent_at > ${run.created_at} LIMIT 1`;
      return m
        ? { kind: "stop", detail: "The customer replied" }
        : { kind: "next", log: "done", detail: "No reply yet" };
    }
    case "send_email":
    case "send_whatsapp": {
      const channel = step.kind === "send_email" ? "email" : "whatsapp";
      const key = `auto:${run.id}:${position}`;
      const [already] = await sql`
        SELECT 1 FROM sales.message WHERE channel = ${channel} AND external_message_id = ${key}`;
      if (already)
        return { kind: "next", log: "skipped", detail: "Already sent" };
      const [p] = await sql`
        SELECT email, coalesce(whatsapp_e164, phone_e164) AS phone, preferred_language
        FROM person WHERE id = ${run.person_id}`;
      const to = channel === "email" ? p?.email : p?.phone;
      if (!to)
        return {
          kind: "next",
          log: "skipped",
          detail:
            channel === "email" ? "No email address" : "No WhatsApp number",
        };
      if (step.settings.purpose === "marketing") {
        const purpose =
          channel === "email" ? "marketing_email" : "marketing_whatsapp";
        const [c] = await sql`
          SELECT is_granted FROM consent_current
          WHERE person_id = ${run.person_id} AND purpose = ${purpose}`;
        if (!c?.is_granted)
          return {
            kind: "next",
            log: "skipped",
            detail: `No ${purpose} consent`,
          };
      }
      const sender = senders[channel];
      if (!sender)
        throw new Final(
          channel === "email"
            ? "Email isn't connected yet"
            : "WhatsApp (WATI) isn't connected yet",
        );
      // The class's language when the trigger has a class (decided 4 Nov),
      // else the person's.
      let language: "en" | "zh" = p.preferred_language === "zh" ? "zh" : "en";
      if (typeof ctx.classId === "string") {
        const [cl] =
          await sql`SELECT language FROM class WHERE id = ${ctx.classId}`;
        if (cl?.language === "zh" || cl?.language === "en")
          language = cl.language;
      }
      await sender({
        channel,
        template: step.settings.template,
        personId: run.person_id,
        to,
        language,
        context: ctx,
        idempotencyKey: key,
      });
      return {
        kind: "next",
        log: "done",
        detail: `Sent ${channel} "${step.settings.template}"`,
      };
    }
  }
}

async function log(
  runId: string,
  position: number | null,
  outcome: string,
  detail: string,
) {
  await db()`
    INSERT INTO sales.automation_log (run_id, position, outcome, detail)
    VALUES (${runId}, ${position}, ${outcome}, ${detail.slice(0, 1000)})`;
}

// ---- One run ----------------------------------------------------------------------

async function advance(
  runId: string,
  senders: Senders,
): Promise<"done" | "waiting" | "stopped" | "failed" | "retry" | "busy"> {
  return withTransaction(async () => {
    const sql = db();
    // Locked, still due, and its automation still on (paused = held).
    const [run] = (await sql`
      SELECT r.id, r.automation_id, r.person_id, r.context, r.next_step, r.attempts, r.created_at
      FROM sales.automation_run r JOIN sales.automation a ON a.id = r.automation_id
      WHERE r.id = ${runId} AND r.status IN ('running','waiting')
        AND r.next_run_at <= now() AND a.active
      FOR UPDATE OF r SKIP LOCKED`) as unknown as Run[];
    if (!run) return "busy";
    const steps = await sql`
      SELECT position, kind, settings FROM sales.automation_step
      WHERE automation_id = ${run.automation_id} AND position >= ${run.next_step}
      ORDER BY position`;
    for (const row of steps) {
      const position = row.position as number;
      const parsed = stepSchema.safeParse({
        kind: row.kind,
        settings: row.settings,
      });
      let outcome: Outcome;
      try {
        if (!parsed.success)
          throw new Final(
            `Step ${position} is not valid; fix it in the editor`,
          );
        // A savepoint per step: a failed step leaves no half-done change.
        outcome = await withTransaction(() =>
          runStep(run, parsed.data, position, senders),
        );
      } catch (e) {
        const message = (e instanceof Error ? e.message : String(e)).slice(
          0,
          500,
        );
        const attempts = run.attempts + 1;
        if (e instanceof Final || attempts >= MAX_ATTEMPTS) {
          await sql`
            UPDATE sales.automation_run
            SET status = 'failed', next_step = ${position}, attempts = ${attempts},
                last_error = ${message}, finished_at = now()
            WHERE id = ${run.id}`;
          await log(run.id, position, "failed", message);
          return "failed";
        }
        await sql`
          UPDATE sales.automation_run
          SET status = 'running', next_step = ${position}, attempts = ${attempts},
              last_error = ${message},
              next_run_at = now() + make_interval(secs => ${BACKOFF_SECONDS[attempts - 1]})
          WHERE id = ${run.id}`;
        await log(run.id, position, "retry", message);
        return "retry";
      }
      if (outcome.kind === "stop") {
        await sql`
          UPDATE sales.automation_run
          SET status = 'stopped', next_step = ${position + 1}, finished_at = now()
          WHERE id = ${run.id}`;
        await log(run.id, position, "stopped", outcome.detail);
        return "stopped";
      }
      if (outcome.kind === "wait") {
        await sql`
          UPDATE sales.automation_run
          SET status = 'waiting', next_step = ${position + 1}, attempts = 0,
              last_error = NULL, next_run_at = ${outcome.until}
          WHERE id = ${run.id}`;
        await log(run.id, position, "waiting", outcome.detail);
        return "waiting";
      }
      await log(run.id, position, outcome.log, outcome.detail);
      run.attempts = 0;
    }
    await sql`
      UPDATE sales.automation_run
      SET status = 'done', next_step = ${((steps.at(-1)?.position as number | undefined) ?? run.next_step - 1) + 1},
          attempts = 0, last_error = NULL, finished_at = now()
      WHERE id = ${run.id}`;
    await log(run.id, null, "done", "Finished");
    return "done";
  });
}

export type RunCounts = Record<
  "done" | "waiting" | "stopped" | "failed" | "retry",
  number
>;

// Every due run of a switched-on automation, a batch at a time.
export async function runDue(
  senders: Senders = {},
  batch = 100,
): Promise<RunCounts> {
  const out: RunCounts = {
    done: 0,
    waiting: 0,
    stopped: 0,
    failed: 0,
    retry: 0,
  };
  const due = await db()`
    SELECT r.id FROM sales.automation_run r
    JOIN sales.automation a ON a.id = r.automation_id AND a.active
    WHERE r.status IN ('running','waiting') AND r.next_run_at <= now()
    ORDER BY r.next_run_at LIMIT ${batch}`;
  for (const d of due) {
    const r = await advance(d.id as string, senders);
    if (r !== "busy") out[r]++;
  }
  return out;
}

// For the editor's "run again" on a failed run: from the step that failed.
export async function retryRun(
  actor: { id: string },
  runId: string,
): Promise<boolean> {
  const rows = await db()`
    UPDATE sales.automation_run
    SET status = 'running', attempts = 0, last_error = NULL, finished_at = NULL,
        next_run_at = now()
    WHERE id = ${runId} AND status = 'failed'
    RETURNING id`;
  if (rows.length)
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "automation_run",
      entityId: runId,
      before: { status: "failed" },
      after: { status: "running" },
    });
  return rows.length > 0;
}
