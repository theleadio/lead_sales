import type { Role } from "../auth/roles.ts";
import { MAX_ATTEMPTS as META_MAX_ATTEMPTS } from "../meta/webhook.ts";
import { db } from "../sql.ts";

// Integration health (CRM spec §11.4, decided 4 Nov for every connection).
// Moved from lead_crm PR #45 (closed): lead_sales owns it now. One row per
// integration: name, lastSuccessAt, lastErrorAt, lastErrorMessage,
// queueDepth, status (ok / degraded / down). Every figure is read from data
// the integration already writes:
//   crm_outbox        the CRM's event_outbox (the CRM's own worker)
//   lms_notices       sales.lms_notice (CRM → LMS, lib/lms)
//   lms_inbound       integration_event, source 'lms' (LMS → CRM)
//   stripe_webhook    integration_event, source 'stripe'
//   meta_leads        integration_event, source 'meta_leadgen'
//   meta_ads_sync     meta_ad_insight.synced_at (lead_crm daily-sync.yml)
//   salesprocess_sync salesprocess_payment.synced_at (lead_crm daily-sync.yml)
// Not covered: the LMS → CRM read sync and the GHL contact import write no
// run timestamp anywhere.
//
// Thresholds are decisions, not facts; change them here.
const QUEUE_STUCK_MINUTES = 15; // a due row older than this: the worker isn't running
const DAILY_SYNC_DEGRADED_HOURS = 26; // one missed 03:00 MYT run, plus slack
const DAILY_SYNC_DOWN_HOURS = 50; // two missed runs
const INBOUND_FAILED_DOWN_HOURS = 24; // senders retry; a day of failure is down

export type HealthStatus = "ok" | "degraded" | "down";

export type IntegrationHealth = {
  key: string;
  name: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  queueDepth: number;
  status: HealthStatus;
  // Dead rows the Retry button can revive; empty where nothing can be.
  retryable: { id: string; type: string; lastError: string | null }[];
};

// Settings is super_admin only in the CRM (spec §6); the same here.
export const canSeeIntegrations = (viewer: { role: Role }) =>
  viewer.role === "super_admin";
export const canRetryIntegrations = canSeeIntegrations;

const iso = (v: unknown): string | null =>
  v ? new Date(v as string).toISOString() : null;

async function crmOutboxHealth(): Promise<IntegrationHealth> {
  const sql = db();
  const [s] = await sql`
    SELECT
      max(processed_at) AS last_success,
      max(updated_at) FILTER (WHERE last_error IS NOT NULL) AS last_error_at,
      count(*) FILTER (WHERE processed_at IS NULL)::int AS queue,
      count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead,
      count(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL
                         AND attempts > 0)::int AS retrying,
      count(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL
                         AND next_attempt_at < now() - make_interval(mins => ${QUEUE_STUCK_MINUTES})
                      )::int AS stuck
    FROM event_outbox`;
  const [last] = await sql`
    SELECT last_error FROM event_outbox WHERE last_error IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1`;
  const dead = await sql`
    SELECT id, type, last_error FROM event_outbox WHERE dead_at IS NOT NULL
    ORDER BY dead_at DESC LIMIT 50`;
  return {
    key: "crm_outbox",
    name: "CRM event outbox (CRM workers)",
    lastSuccessAt: iso(s.last_success),
    lastErrorAt: iso(s.last_error_at),
    lastErrorMessage: (last?.last_error as string | undefined) ?? null,
    queueDepth: s.queue,
    status:
      s.dead > 0 ? "down" : s.retrying > 0 || s.stuck > 0 ? "degraded" : "ok",
    retryable: dead.map((d) => ({
      id: d.id as string,
      type: d.type as string,
      lastError: (d.last_error as string | null) ?? null,
    })),
  };
}

async function lmsNoticeHealth(): Promise<IntegrationHealth> {
  const sql = db();
  const [s] = await sql`
    SELECT
      max(sent_at) AS last_success,
      max(next_attempt_at) FILTER (WHERE last_error IS NOT NULL) AS last_error_at,
      count(*) FILTER (WHERE sent_at IS NULL AND skipped_reason IS NULL
                         AND dead_at IS NULL)::int AS queue,
      count(*) FILTER (WHERE dead_at IS NOT NULL)::int AS dead,
      count(*) FILTER (WHERE sent_at IS NULL AND dead_at IS NULL
                         AND skipped_reason IS NULL AND attempts > 0)::int AS retrying,
      count(*) FILTER (WHERE sent_at IS NULL AND dead_at IS NULL
                         AND skipped_reason IS NULL
                         AND next_attempt_at < now() - make_interval(mins => ${QUEUE_STUCK_MINUTES})
                      )::int AS stuck
    FROM sales.lms_notice`;
  const [last] = await sql`
    SELECT last_error FROM sales.lms_notice WHERE last_error IS NOT NULL
    ORDER BY next_attempt_at DESC LIMIT 1`;
  const dead = await sql`
    SELECT id, kind, last_error FROM sales.lms_notice WHERE dead_at IS NOT NULL
    ORDER BY dead_at DESC LIMIT 50`;
  return {
    key: "lms_notices",
    name: "LMS notices (CRM → LMS)",
    lastSuccessAt: iso(s.last_success),
    lastErrorAt: iso(s.last_error_at),
    lastErrorMessage: (last?.last_error as string | undefined) ?? null,
    queueDepth: s.queue,
    status:
      s.dead > 0 ? "down" : s.retrying > 0 || s.stuck > 0 ? "degraded" : "ok",
    retryable: dead.map((d) => ({
      id: d.id as string,
      type: d.kind as string,
      lastError: (d.last_error as string | null) ?? null,
    })),
  };
}

// Inbound webhooks: Stripe and the LMS redeliver on their own, so there is
// nothing to revive, only to report. Meta leads are retried by meta:run;
// the ones that ran out of tries can be revived (after fixing the cause,
// e.g. a new Page token).
async function inboundHealth(
  source: "stripe" | "lms" | "meta_leadgen",
  name: string,
): Promise<IntegrationHealth> {
  const sql = db();
  const [s] = await sql`
    SELECT
      max(processed_at) FILTER (WHERE status IN ('processed','ignored')) AS last_success,
      max(processed_at) FILTER (WHERE status = 'failed') AS last_error_at,
      count(*) FILTER (WHERE status IN ('received','failed'))::int AS queue,
      count(*) FILTER (WHERE status = 'failed'
                         AND received_at < now() - make_interval(hours => ${INBOUND_FAILED_DOWN_HOURS})
                      )::int AS old_failed,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM integration_event WHERE source = ${source}`;
  const [last] = await sql`
    SELECT error FROM integration_event
    WHERE source = ${source} AND status = 'failed'
    ORDER BY processed_at DESC NULLS LAST LIMIT 1`;
  return {
    key:
      source === "stripe"
        ? "stripe_webhook"
        : source === "meta_leadgen"
          ? "meta_leads"
          : "lms_inbound",
    name,
    lastSuccessAt: iso(s.last_success),
    lastErrorAt: iso(s.last_error_at),
    lastErrorMessage: (last?.error as string | undefined) ?? null,
    queueDepth: s.queue,
    status: s.old_failed > 0 ? "down" : s.failed > 0 ? "degraded" : "ok",
    retryable:
      source === "meta_leadgen"
        ? (
            await sql`
              SELECT id, error FROM integration_event
              WHERE source = 'meta_leadgen' AND status = 'failed'
                AND attempts >= ${META_MAX_ATTEMPTS}
              ORDER BY received_at DESC LIMIT 50`
          ).map((d) => ({
            id: d.id as string,
            type: "meta lead",
            lastError: (d.error as string | null) ?? null,
          }))
        : [],
  };
}

async function dailySyncHealth(
  key: string,
  name: string,
  table: "meta_ad_insight" | "salesprocess_payment",
): Promise<IntegrationHealth> {
  const sql = db();
  const [s] = await sql`
    SELECT max(synced_at) AS last,
           extract(epoch FROM now() - max(synced_at)) / 3600 AS hours
    FROM ${sql(table)}`;
  const hours = s.hours === null ? null : Number(s.hours);
  const status: HealthStatus =
    hours === null || hours > DAILY_SYNC_DOWN_HOURS
      ? "down"
      : hours > DAILY_SYNC_DEGRADED_HOURS
        ? "degraded"
        : "ok";
  return {
    key,
    name,
    lastSuccessAt: iso(s.last),
    lastErrorAt: null,
    // The job's own errors are in lead_crm's GitHub Actions log.
    lastErrorMessage:
      hours === null
        ? "Never synced"
        : status === "ok"
          ? null
          : `Last synced ${Math.floor(hours)} hours ago; check lead_crm's daily-sync workflow run`,
    queueDepth: 0,
    status,
    retryable: [],
  };
}

export async function integrationHealth(): Promise<IntegrationHealth[]> {
  return [
    await crmOutboxHealth(),
    await lmsNoticeHealth(),
    await inboundHealth("lms", "LMS attendance and completion (LMS → CRM)"),
    await inboundHealth("stripe", "Stripe payments (webhook)"),
    await inboundHealth("meta_leadgen", "Meta lead forms (webhook)"),
    await dailySyncHealth("meta_ads_sync", "Meta ads sync", "meta_ad_insight"),
    await dailySyncHealth(
      "salesprocess_sync",
      "SalesProcess payments sync",
      "salesprocess_payment",
    ),
  ];
}

// The Retry button: revive dead rows, all of an integration's or the ids
// given, so the next run tries them again. For the CRM outbox this writes the
// CRM's event_outbox the way lead_crm's retryDeadEvents() does.
export async function retryIntegration(input: {
  integration: "crm_outbox" | "lms_notices" | "meta_leads";
  ids?: string[];
}): Promise<number> {
  const sql = db();
  const ids = input.ids ?? null;
  if (input.integration === "meta_leads")
    return (
      await sql`
        UPDATE integration_event
        SET attempts = 0, next_attempt_at = now(), updated_at = now()
        WHERE source = 'meta_leadgen' AND status = 'failed'
          AND attempts >= ${META_MAX_ATTEMPTS}
          AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
        RETURNING id`
    ).length;
  const rows =
    input.integration === "crm_outbox"
      ? await sql`
          UPDATE event_outbox
          SET dead_at = NULL, attempts = 0, next_attempt_at = now()
          WHERE dead_at IS NOT NULL
            AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
          RETURNING id`
      : await sql`
          UPDATE sales.lms_notice
          SET dead_at = NULL, attempts = 0, next_attempt_at = now()
          WHERE dead_at IS NOT NULL
            AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
          RETURNING id`;
  return rows.length;
}
