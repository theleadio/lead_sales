import type postgres from "postgres";
import { createHash } from "node:crypto";
import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { isValidEmail } from "../crm/email.ts";
import { raiseEvent } from "../crm/events.ts";
import { isUuid } from "../crm/people.ts";
import { db, withTransaction } from "../sql.ts";
import {
  BATCH_SIZE,
  cleanBody,
  renderCampaign,
  sendBatch,
  signUnsubscribe,
  unsubscribeUrl,
  type Language,
  type OutgoingEmail,
} from "./campaign.ts";
import {
  blocksSchema,
  renderBlocks,
  STARTER_BLOCKS,
  type Block,
} from "./blocks.ts";

// Email marketing: newsletter campaigns to people who agreed to hear from
// LEAD. The rule that matters (spec §7.12, PDPA): a campaign only ever goes to
// a person whose LATEST `marketing_email` consent row is a grant. No row means
// no consent. Nothing here grants consent; only a person's own tick on a form,
// or a documented import (scripts/consent-import.ts), does.

export type Actor = { id: string; role: Role };

export class EmailError extends Error {
  // Not a parameter property: Node runs this file with types stripped.
  readonly code: "forbidden" | "not_found" | "invalid" | "not_configured";
  constructor(code: EmailError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// Who may write and send campaigns: marketing's own tool, plus the two
// management roles.
const EDITORS: readonly Role[] = ["super_admin", "management", "marketing"];
export const canEditEmail = (role: Role) => EDITORS.includes(role);

async function guard(actor: Actor, what: string) {
  if (canEditEmail(actor.role)) return;
  await writeAudit({
    userId: actor.id,
    action: "permission_denied",
    entity: "email_campaign",
    entityId: null,
    before: null,
    after: { what },
  });
  throw new EmailError(
    "forbidden",
    "Only marketing, management and super_admin can use email marketing.",
  );
}

// ---- Audience ---------------------------------------------------------------

export type Audience = { tagIds: string[]; language: Language | null };

export type Recipient = {
  personId: string;
  email: string;
  name: string | null;
};

// Everyone a campaign with this audience would reach right now: alive, with
// an address, latest email-marketing consent a grant, matching the filters.
// `campaignId` leaves out people already queued for that campaign.
async function audienceRows(
  a: Audience,
  opts: { limit?: number; excludeCampaign?: string } = {},
): Promise<Recipient[]> {
  const sql = db();
  const rows = await sql`
    SELECT p.id, p.email, coalesce(p.preferred_name, p.full_name) AS name
    FROM person p
    JOIN consent_current c
      ON c.person_id = p.id AND c.purpose = 'marketing_email' AND c.is_granted
    WHERE p.deleted_at IS NULL AND p.erased_at IS NULL
      AND p.merged_into_id IS NULL
      AND p.email IS NOT NULL
      AND (cardinality(${a.tagIds}::uuid[]) = 0 OR EXISTS (
            SELECT 1 FROM person_tag pt
            WHERE pt.person_id = p.id AND pt.tag_id = ANY(${a.tagIds}::uuid[])))
      AND (${a.language}::text IS NULL OR p.preferred_language = ${a.language})
      AND (${opts.excludeCampaign ?? null}::uuid IS NULL OR NOT EXISTS (
            SELECT 1 FROM sales.email_send s
            WHERE s.campaign_id = ${opts.excludeCampaign ?? null}::uuid
              AND s.person_id = p.id))
    ORDER BY p.id
    ${opts.limit ? sql`LIMIT ${opts.limit}` : sql``}`;
  return rows
    .filter((r) => isValidEmail(r.email))
    .map((r) => ({ personId: r.id, email: r.email, name: r.name }));
}

export async function audienceSize(a: Audience): Promise<number> {
  const sql = db();
  // Count in SQL; the address check is the same loose rule (an @ and a dot
  // in the domain), so the number matches what is queued.
  const [r] = await sql`
    SELECT count(*)::int AS n
    FROM person p
    JOIN consent_current c
      ON c.person_id = p.id AND c.purpose = 'marketing_email' AND c.is_granted
    WHERE p.deleted_at IS NULL AND p.erased_at IS NULL
      AND p.merged_into_id IS NULL
      AND p.email ~ '^[^@]+@[^@]+[.][^@]*$'
      AND (cardinality(${a.tagIds}::uuid[]) = 0 OR EXISTS (
            SELECT 1 FROM person_tag pt
            WHERE pt.person_id = p.id AND pt.tag_id = ANY(${a.tagIds}::uuid[])))
      AND (${a.language}::text IS NULL OR p.preferred_language = ${a.language})`;
  return r.n as number;
}

// First few names, so the preview shows real people, not only a count.
export async function audienceSample(
  a: Audience,
  n = 5,
): Promise<{ name: string | null }[]> {
  const rows = await audienceRows(a, { limit: n });
  return rows.map((r) => ({ name: r.name }));
}

// The numbers behind the screen: how many people could ever be emailed.
export async function consentSummary(): Promise<{
  withEmail: number;
  consented: number;
}> {
  const [r] = await db()`
    SELECT
      count(*) FILTER (WHERE p.email IS NOT NULL)::int AS with_email,
      count(*) FILTER (WHERE p.email IS NOT NULL AND c.is_granted)::int AS consented
    FROM person p
    LEFT JOIN consent_current c
      ON c.person_id = p.id AND c.purpose = 'marketing_email'
    WHERE p.deleted_at IS NULL AND p.erased_at IS NULL
      AND p.merged_into_id IS NULL`;
  return { withEmail: r.with_email, consented: r.consented };
}

export async function listTags(): Promise<{ id: string; name: string }[]> {
  const rows = await db()`
    SELECT id, name FROM tag WHERE is_active ORDER BY lower(name)`;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

// ---- Campaigns --------------------------------------------------------------

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent";

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  language: Language | null;
  bodyHtml: string;
  tagIds: string[];
  // Editor blocks; null for a campaign written as raw HTML.
  blocks: Block[] | null;
  status: CampaignStatus;
  createdAt: Date;
  scheduledAt: Date | null;
  // Why a scheduled campaign came back to draft.
  note: string | null;
  queuedAt: Date | null;
  sentAt: Date | null;
  recipientCount: number | null;
  counts: { queued: number; sent: number; failed: number; skipped: number };
};

// Stored blocks that no longer pass the schema open as HTML instead of
// failing the page.
function parseBlocks(v: unknown): Block[] | null {
  if (v == null) return null;
  const p = blocksSchema.safeParse(v);
  return p.success ? p.data : null;
}

const toCampaign = (r: postgres.Row): CampaignRow => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  language: r.language,
  bodyHtml: r.body_html,
  tagIds: r.tag_ids,
  blocks: parseBlocks(r.blocks),
  status: r.status,
  createdAt: r.created_at,
  scheduledAt: r.scheduled_at ?? null,
  note: r.note ?? null,
  queuedAt: r.queued_at,
  sentAt: r.sent_at,
  recipientCount: r.recipient_count,
  counts: {
    queued: r.queued ?? 0,
    sent: r.sent ?? 0,
    failed: r.failed ?? 0,
    skipped: r.skipped ?? 0,
  },
});

const WITH_COUNTS = (sql: ReturnType<typeof db>) => sql`
  SELECT c.*,
    count(s.*) FILTER (WHERE s.status = 'queued')::int  AS queued,
    count(s.*) FILTER (WHERE s.status = 'sent')::int    AS sent,
    count(s.*) FILTER (WHERE s.status = 'failed')::int  AS failed,
    count(s.*) FILTER (WHERE s.status = 'skipped')::int AS skipped
  FROM sales.email_campaign c
  LEFT JOIN sales.email_send s ON s.campaign_id = c.id`;

export async function listCampaigns(): Promise<CampaignRow[]> {
  const sql = db();
  const rows = await sql`
    ${WITH_COUNTS(sql)}
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT 200`;
  return rows.map(toCampaign);
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [r] = await sql`
    ${WITH_COUNTS(sql)}
    WHERE c.id = ${id}
    GROUP BY c.id`;
  return r ? toCampaign(r) : null;
}

export async function createDraft(actor: Actor): Promise<string> {
  await guard(actor, "create campaign");
  const starter = STARTER_BLOCKS();
  const [r] = await db()`
    INSERT INTO sales.email_campaign (created_by, name, subject, blocks, body_html)
    VALUES (${actor.id}, 'Untitled campaign', 'Subject',
            ${db().json(starter as never)}::jsonb, ${cleanBody(renderBlocks(starter))})
    RETURNING id`;
  await writeAudit({
    userId: actor.id,
    action: "create",
    entity: "email_campaign",
    entityId: r.id,
    before: null,
    after: null,
  });
  return r.id as string;
}

export type CampaignInput = {
  id: string;
  name: string;
  subject: string;
  language: Language | null;
  bodyHtml: string;
  // When set, the email is made from these and bodyHtml is ignored.
  blocks: Block[] | null;
  tagIds: string[];
};

export async function saveCampaign(
  actor: Actor,
  input: CampaignInput,
): Promise<void> {
  await guard(actor, "save campaign");
  const name = input.name.trim();
  const subject = input.subject.trim();
  if (!name || name.length > 120)
    throw new EmailError("invalid", "A name of up to 120 characters.");
  if (!subject || subject.length > 200)
    throw new EmailError("invalid", "A subject of up to 200 characters.");
  if (
    input.language !== null &&
    input.language !== "en" &&
    input.language !== "zh"
  )
    throw new EmailError("invalid", "Unknown language.");
  if (!input.tagIds.every(isUuid))
    throw new EmailError("invalid", "Unknown tag.");
  let blocks: Block[] | null = null;
  if (input.blocks !== null) {
    const p = blocksSchema.safeParse(input.blocks);
    if (!p.success)
      throw new EmailError(
        "invalid",
        p.error.issues[0]?.message ?? "A block isn't valid.",
      );
    blocks = p.data;
  }
  const bodyHtml = cleanBody(blocks ? renderBlocks(blocks) : input.bodyHtml);
  if (bodyHtml.length > 200000)
    throw new EmailError("invalid", "The email is too long.");
  const sql = db();
  const [r] = await sql`
    UPDATE sales.email_campaign
    SET name = ${name}, subject = ${subject}, language = ${input.language},
        body_html = ${bodyHtml}, tag_ids = ${input.tagIds}::uuid[],
        blocks = ${blocks ? sql.json(blocks as never) : null}::jsonb,
        note = NULL, updated_at = now()
    WHERE id = ${input.id} AND status = 'draft'
    RETURNING id`;
  if (!r)
    throw new EmailError(
      "not_found",
      "That campaign is gone or already sent, so it can't be changed.",
    );
  await writeAudit({
    userId: actor.id,
    action: "update",
    entity: "email_campaign",
    entityId: input.id,
    before: null,
    after: { name },
  });
}

// ---- Sending ----------------------------------------------------------------

// Queues the campaign: one email_send row per person in the audience right
// now, and the campaign moves to "sending". The background job sends them.
// Only a draft can be queued this way, and only once.
export async function queueCampaign(actor: Actor, id: string): Promise<number> {
  await guard(actor, "send campaign");
  return queueFrom(id, "draft", actor.id);
}

// Moves a campaign from `from` to "sending" and queues its audience as it is
// at this moment (so consent and tags are read at send time, also for a
// scheduled campaign). Throws, and changes nothing, when it can't.
async function queueFrom(
  id: string,
  from: "draft" | "scheduled",
  userId: string | null,
): Promise<number> {
  return withTransaction(async () => {
    const sql = db();
    const [c] = await sql`
      UPDATE sales.email_campaign
      SET status = 'sending', queued_at = now(), updated_at = now(), note = NULL
      WHERE id = ${id} AND status = ${from}
      RETURNING tag_ids, language, body_html`;
    if (!c)
      throw new EmailError(
        "not_found",
        "That campaign is gone or was already sent.",
      );
    if (!c.body_html.trim())
      throw new EmailError("invalid", "The email has no content yet.");
    const people = await audienceRows({
      tagIds: c.tag_ids,
      language: c.language,
    });
    if (people.length === 0)
      throw new EmailError(
        "invalid",
        "No one with email consent matches this audience.",
      );
    // Chunked inserts keep each statement well under the parameter limit.
    for (let i = 0; i < people.length; i += 2000) {
      const chunk = people.slice(i, i + 2000);
      await sql`
        INSERT INTO sales.email_send (campaign_id, person_id, email)
        SELECT ${id}, x."personId", x.email
        FROM jsonb_to_recordset(${sql.json(chunk as never)}::jsonb)
          AS x("personId" uuid, email text)
        ON CONFLICT DO NOTHING`;
    }
    await sql`
      UPDATE sales.email_campaign SET recipient_count = ${people.length}
      WHERE id = ${id}`;
    await writeAudit({
      userId,
      action: "update",
      entity: "email_campaign",
      entityId: id,
      before: { status: from },
      after: { status: "sending", recipients: people.length },
    });
    return people.length;
  });
}

// ---- Scheduling -------------------------------------------------------------

// A scheduled send must be at least this far ahead (the job runs every 5
// minutes, so "in 2 minutes" would only mislead) and at most a year out.
export const MIN_SCHEDULE_AHEAD_MS = 10 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
// A scheduled campaign the job reaches more than this late (the job was off)
// is not sent on its own: what it says may no longer be true.
export const MAX_SCHEDULE_LATE_MS = 12 * 60 * 60 * 1000;

// Sets a draft to go out at `at`. The audience is worked out when it goes,
// not now, so someone who unsubscribes in between isn't emailed. While it is
// scheduled it can't be changed; cancel the schedule first.
export async function scheduleCampaign(
  actor: Actor,
  id: string,
  at: Date,
  now: Date = new Date(),
): Promise<void> {
  await guard(actor, "schedule campaign");
  if (!isUuid(id)) throw new EmailError("not_found", "That campaign is gone.");
  const ahead = at.getTime() - now.getTime();
  if (!(ahead >= MIN_SCHEDULE_AHEAD_MS))
    throw new EmailError(
      "invalid",
      "Pick a time at least 10 minutes from now.",
    );
  if (ahead > MAX_SCHEDULE_AHEAD_MS)
    throw new EmailError("invalid", "Pick a time within the next year.");
  const sql = db();
  const [c] = await sql`
    UPDATE sales.email_campaign
    SET status = 'scheduled', scheduled_at = ${at}, note = NULL,
        updated_at = now()
    WHERE id = ${id} AND status = 'draft' AND btrim(body_html) <> ''
    RETURNING id`;
  if (!c)
    throw new EmailError(
      "not_found",
      "That campaign is gone, already sent, or has no content yet.",
    );
  await writeAudit({
    userId: actor.id,
    action: "update",
    entity: "email_campaign",
    entityId: id,
    before: { status: "draft" },
    after: { status: "scheduled", scheduledAt: at.toISOString() },
  });
}

// Back to draft, so it can be changed or sent now.
export async function unscheduleCampaign(
  actor: Actor,
  id: string,
): Promise<void> {
  await guard(actor, "cancel scheduled campaign");
  if (!isUuid(id)) throw new EmailError("not_found", "That campaign is gone.");
  const [c] = await db()`
    UPDATE sales.email_campaign
    SET status = 'draft', scheduled_at = NULL, updated_at = now()
    WHERE id = ${id} AND status = 'scheduled'
    RETURNING id`;
  if (!c)
    throw new EmailError(
      "not_found",
      "That campaign isn't scheduled any more (it may already be sending).",
    );
  await writeAudit({
    userId: actor.id,
    action: "update",
    entity: "email_campaign",
    entityId: id,
    before: { status: "scheduled" },
    after: { status: "draft" },
  });
}

// For the email job: queues every scheduled campaign whose time has come.
// One that can't go (no one matches any more, or the job reached it more than
// 12 hours late) goes back to draft with a note saying why, for a person to
// look at. Returns what happened, as counts.
export async function queueDueCampaigns(
  now: Date = new Date(),
): Promise<{ queued: number; returned: number }> {
  const sql = db();
  const due = await sql`
    SELECT id, scheduled_at FROM sales.email_campaign
    WHERE status = 'scheduled' AND scheduled_at <= ${now}
    ORDER BY scheduled_at
    LIMIT 50`;
  const out = { queued: 0, returned: 0 };
  for (const c of due) {
    let note: string | null = null;
    if (now.getTime() - c.scheduled_at.getTime() > MAX_SCHEDULE_LATE_MS) {
      note =
        "Not sent: the sending job reached it more than 12 hours after its time. Check it is still right, then send or schedule it again.";
    } else {
      try {
        await queueFrom(c.id, "scheduled", null);
        out.queued++;
        continue;
      } catch (e) {
        if (!(e instanceof EmailError)) throw e;
        // Gone or already moved on by someone else: nothing to do.
        if (e.code === "not_found") continue;
        note = `Not sent at its scheduled time: ${e.message}`;
      }
    }
    const [r] = await sql`
      UPDATE sales.email_campaign
      SET status = 'draft', scheduled_at = NULL, note = ${note},
          updated_at = now()
      WHERE id = ${c.id} AND status = 'scheduled'
      RETURNING id`;
    if (r) {
      out.returned++;
      await writeAudit({
        userId: null,
        action: "update",
        entity: "email_campaign",
        entityId: c.id,
        before: { status: "scheduled" },
        after: { status: "draft", note },
      });
    }
  }
  return out;
}

// ---- Duplicate --------------------------------------------------------------

// A new draft with the same words and audience as any campaign (sent ones
// too), named "Copy of …". Returns the new campaign's id.
export async function duplicateCampaign(
  actor: Actor,
  id: string,
): Promise<string> {
  await guard(actor, "duplicate campaign");
  if (!isUuid(id)) throw new EmailError("not_found", "That campaign is gone.");
  const [r] = await db()`
    INSERT INTO sales.email_campaign
      (created_by, name, subject, language, body_html, blocks, tag_ids)
    SELECT ${actor.id}, left('Copy of ' || name, 120), subject, language,
           body_html, blocks, tag_ids
    FROM sales.email_campaign WHERE id = ${id}
    RETURNING id`;
  if (!r) throw new EmailError("not_found", "That campaign is gone.");
  await writeAudit({
    userId: actor.id,
    action: "create",
    entity: "email_campaign",
    entityId: r.id,
    before: null,
    after: { duplicateOf: id },
  });
  return r.id as string;
}

// ---- The sending job --------------------------------------------------------

export type MailConfig = {
  apiKey: string;
  from: string;
  // Public address of this app, for the unsubscribe link.
  baseUrl: string;
  // Signs the unsubscribe links.
  secret: string;
  fetchImpl?: typeof fetch;
};

// The config from env, or null while any part is missing: nothing is sent
// without a verified sender and a working unsubscribe link.
export function mailConfigFromEnv(): MailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const baseUrl = process.env.APP_BASE_URL;
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  return apiKey && from && baseUrl && secret
    ? { apiKey, from, baseUrl, secret }
    : null;
}

const MAX_ATTEMPTS = 3;

// Sends up to `maxBatches` batches of queued emails, oldest campaign first.
// Consent is checked again right before each batch: someone who unsubscribed
// since the campaign was queued is skipped, not emailed. A batch Resend
// refuses for a passing reason (busy, unreachable) goes back to the queue up
// to three times; any other refusal marks its rows failed. Campaigns with
// nothing left queued become "sent".
export async function processEmailQueue(
  cfg: MailConfig,
  maxBatches = 20,
): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  finished: number;
}> {
  const sql = db();
  const out = { sent: 0, skipped: 0, failed: 0, finished: 0 };

  for (let b = 0; b < maxBatches; b++) {
    const [c] = await sql`
      SELECT c.id, c.subject, c.body_html, c.language
      FROM sales.email_campaign c
      WHERE c.status = 'sending'
        AND EXISTS (SELECT 1 FROM sales.email_send s
                    WHERE s.campaign_id = c.id AND s.status = 'queued')
      ORDER BY c.queued_at
      LIMIT 1`;
    if (!c) break;

    const rows = await sql`
      SELECT s.id, s.person_id, s.email, s.attempts,
             coalesce(p.preferred_name, p.full_name) AS name,
             p.preferred_language AS language,
             coalesce(cc.is_granted, false) AS consented,
             (p.deleted_at IS NOT NULL OR p.erased_at IS NOT NULL
              OR p.merged_into_id IS NOT NULL) AS gone
      FROM sales.email_send s
      JOIN person p ON p.id = s.person_id
      LEFT JOIN consent_current cc
        ON cc.person_id = s.person_id AND cc.purpose = 'marketing_email'
      WHERE s.campaign_id = ${c.id} AND s.status = 'queued'
      ORDER BY s.id
      LIMIT ${BATCH_SIZE}`;

    const skip = rows.filter((r) => !r.consented || r.gone);
    if (skip.length) {
      await sql`
        UPDATE sales.email_send
        SET status = 'skipped', error = 'No longer consented'
        WHERE id = ANY(${skip.map((r) => r.id)}::bigint[])`;
      out.skipped += skip.length;
    }
    const go = rows.filter((r) => r.consented && !r.gone);
    if (go.length) {
      const emails: OutgoingEmail[] = go.map((r) => {
        const url = unsubscribeUrl(
          cfg.baseUrl,
          signUnsubscribe(r.person_id, cfg.secret),
        );
        // A campaign's language wins; "all languages" uses the person's own.
        const language: Language =
          c.language ?? (r.language === "zh" ? "zh" : "en");
        const m = renderCampaign({
          bodyHtml: c.body_html,
          name: r.name,
          language,
          unsubscribeUrl: url,
        });
        return {
          to: r.email,
          subject: c.subject,
          html: m.html,
          text: m.text,
          unsubscribeUrl: url,
        };
      });
      const ids = go.map((r) => r.id as string);
      // The same rows always give the same key, so a retry after a crash
      // between the send and the update can't send the batch twice.
      const key = `email-marketing:${c.id}:${createHash("sha256")
        .update(ids.join(","))
        .digest("hex")
        .slice(0, 32)}`;
      const r = await sendBatch({
        apiKey: cfg.apiKey,
        from: cfg.from,
        emails,
        idempotencyKey: key,
        fetchImpl: cfg.fetchImpl,
      });
      if (r.ok) {
        await sql`
          UPDATE sales.email_send SET status = 'sent', sent_at = now(), error = NULL
          WHERE id = ANY(${ids}::bigint[])`;
        out.sent += go.length;
      } else {
        const again = go.filter(
          (x) => r.retry && x.attempts + 1 < MAX_ATTEMPTS,
        );
        const dead = go.filter((x) => !again.includes(x));
        if (again.length)
          await sql`
            UPDATE sales.email_send
            SET attempts = attempts + 1, error = ${r.error}
            WHERE id = ANY(${again.map((x) => x.id)}::bigint[])`;
        if (dead.length) {
          await sql`
            UPDATE sales.email_send
            SET status = 'failed', attempts = attempts + 1, error = ${r.error}
            WHERE id = ANY(${dead.map((x) => x.id)}::bigint[])`;
          out.failed += dead.length;
        }
        // Resend is struggling: stop here, the next run carries on.
        if (r.retry) break;
      }
    }
  }

  const done = await sql`
    UPDATE sales.email_campaign c
    SET status = 'sent', sent_at = now(), updated_at = now()
    WHERE c.status = 'sending'
      AND NOT EXISTS (SELECT 1 FROM sales.email_send s
                      WHERE s.campaign_id = c.id AND s.status = 'queued')
    RETURNING c.id`;
  out.finished = done.length;
  return out;
}

// One test email, to the person pressing the button. No consent needed: it
// goes to staff, and nothing is recorded.
export async function sendTest(
  actor: Actor,
  cfg: MailConfig,
  id: string,
  to: string,
): Promise<void> {
  await guard(actor, "send test email");
  const c = await getCampaign(id);
  if (!c) throw new EmailError("not_found", "That campaign is gone.");
  if (!isValidEmail(to))
    throw new EmailError("invalid", "Your account has no email address.");
  const url = unsubscribeUrl(
    cfg.baseUrl,
    signUnsubscribe("00000000-0000-0000-0000-000000000000", cfg.secret),
  );
  const m = renderCampaign({
    bodyHtml: c.bodyHtml,
    name: "Test",
    language: c.language ?? "en",
    unsubscribeUrl: url,
  });
  const r = await sendBatch({
    apiKey: cfg.apiKey,
    from: cfg.from,
    emails: [
      {
        to,
        subject: `[Test] ${c.subject}`,
        html: m.html,
        text: m.text,
        unsubscribeUrl: url,
      },
    ],
    idempotencyKey: `email-test:${id}:${crypto.randomUUID()}`,
    fetchImpl: cfg.fetchImpl,
  });
  if (!r.ok) throw new EmailError("invalid", `Test email failed: ${r.error}.`);
}

// ---- Unsubscribe ------------------------------------------------------------

// Records the withdrawal of email-marketing consent, the same way the CRM
// does: a new consent row, never an edit, and a ConsentChanged event. Returns
// false when there was nothing to withdraw (unknown person, or already
// withdrawn or never granted). Safe to repeat.
export async function unsubscribe(personId: string): Promise<boolean> {
  if (!isUuid(personId)) return false;
  return withTransaction(async () => {
    const sql = db();
    const [latest] = await sql`
      SELECT is_granted FROM consent_current
      WHERE person_id = ${personId} AND purpose = 'marketing_email'`;
    if (!latest?.is_granted) return false;
    await sql`
      INSERT INTO consent (person_id, purpose, is_granted, source, recorded_at)
      VALUES (${personId}, 'marketing_email', false, 'unsubscribe_link', clock_timestamp())`;
    await raiseEvent(
      "ConsentChanged",
      personId,
      { personId, purpose: "marketing_email", isGranted: false },
      null,
    );
    await writeAudit({
      userId: null,
      action: "update",
      entity: "consent",
      entityId: personId,
      before: { marketing_email: true },
      after: { marketing_email: false, source: "unsubscribe_link" },
    });
    return true;
  });
}
