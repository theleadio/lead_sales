import { createHmac } from "node:crypto";
import { z } from "zod";
import { writeAudit } from "../audit.ts";
import { findDuplicate } from "../crm/dedupe.ts";
import { isValidEmail, normalizeEmail } from "../crm/email.ts";
import { dedupeCandidates, raiseDuplicateTask } from "../crm/people.ts";
import { normalizePhoneE164 } from "../crm/phone.ts";
import { db, withTransaction } from "../sql.ts";
import { createTicket } from "../tickets/service.ts";

// The website help form (inbox spec §4 and §5): the customer picks a
// category, so the ticket is made at once with that category's team and
// assignee (routing is deterministic, no guessing).
//
// One submission becomes, in one transaction:
//   - the person: matched by email or phone with the CRM's own duplicate
//     rules (a soft match still creates, flagged for review, as the CRM
//     does), or created
//   - a web_form conversation and the customer's message in it
//   - a ticket (source web_form), with the next-working-day deadline
//
// Abuse protection (spec: "reuses the CRM's public-form protection"):
//   - rate limits: 10 a minute per IP (keyed hash, never the IP itself) and
//     3 an hour per email or phone, the CRM's numbers
//   - a CAPTCHA check runs when one is configured (TURNSTILE_SECRET_KEY);
//     none is chosen yet (decided 4 Nov: start without one)
//   - a repeated idempotency key returns the first ticket, never a second
//
// It records no marketing consent: asking for help is not agreeing to
// marketing. Logs never hold the message, name, email, phone or IP.

export type Env = Record<string, string | undefined>;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const helpFormSchema = z
  .object({
    fullName: z
      .string({ error: "Your name is required" })
      .trim()
      .min(1, "Your name is required")
      .max(200),
    email: text(254).refine(
      (v) => v === null || isValidEmail(v),
      "Enter a valid email",
    ),
    phone: text(40),
    category: z
      .string({ error: "Choose a topic" })
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,30}$/, "Choose a topic"),
    message: z
      .string({ error: "Tell us a little more" })
      .trim()
      .min(5, "Tell us a little more")
      .max(5000, "Up to 5000 characters"),
    preferredLanguage: z
      .enum(["en", "zh"])
      .nullish()
      .transform((v) => v ?? "en"),
    // A client may send one so a double submit can't make two tickets.
    idempotencyKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.:-]{8,100}$/)
      .nullish()
      .transform((v) => v || null),
    captchaToken: z.string().max(4096).nullish(),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone)
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email or a phone number",
      });
  });
export type HelpFormInput = z.output<typeof helpFormSchema>;

export type HelpResult =
  | { kind: "created"; ticketNumber: string; replayed: boolean }
  | { kind: "rate_limited" }
  | { kind: "captcha_failed" }
  | { kind: "unknown_category" };

// ---- Abuse protection ---------------------------------------------------------

export type CaptchaVerifier = (
  token: string | null | undefined,
  ip: string | null,
) => Promise<boolean>;

const TURNSTILE_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare Turnstile, the CRM's fallback provider (its lib/public/guard.ts),
// used only once TURNSTILE_SECRET_KEY is set. Until a provider is chosen the
// form is open, protected by the rate limits alone.
export function helpCaptcha(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): CaptchaVerifier | null {
  const secret = (env.TURNSTILE_SECRET_KEY ?? "").trim();
  if (!secret) return null;
  return async (token, ip) => {
    if (!token) return false;
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set("remoteip", ip);
      const res = await fetchImpl(TURNSTILE_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok && (await res.json()).success === true;
    } catch {
      return false;
    }
  };
}

export const IP_LIMIT_PER_MINUTE = 10;
export const CONTACT_LIMIT_PER_HOUR = 3;

// The IP bucket is an HMAC of the address keyed with RATE_LIMIT_SECRET, so
// the CRM's rate_limit_hit table never holds an IP. Without a secret (16+
// characters) the form stays closed rather than unlimited.
async function ipLimited(env: Env, ip: string | null): Promise<boolean> {
  const secret = (env.RATE_LIMIT_SECRET ?? "").trim();
  if (secret.length < 16) throw new Error("RATE_LIMIT_SECRET not configured");
  const bucket = ip
    ? `help-ip:${createHmac("sha256", secret).update(ip).digest("hex")}`
    : "help-ip:unknown";
  const [r] = await db()`SELECT rate_limit_take(${bucket}, 60) AS hits`;
  return r.hits > IP_LIMIT_PER_MINUTE;
}

// Help-form messages from this email or phone in the last hour.
async function contactLimited(
  emailNorm: string | null,
  phoneE164: string | null,
): Promise<boolean> {
  if (!emailNorm && !phoneE164) return false;
  const [r] = await db()`
    SELECT count(*)::int AS n
    FROM sales.message m JOIN person p ON p.id = m.person_id
    WHERE m.channel = 'web_form' AND m.direction = 'in'
      AND m.sent_at > now() - interval '1 hour'
      AND (${emailNorm}::text IS NOT NULL AND p.email_norm = ${emailNorm}
           OR ${phoneE164}::text IS NOT NULL AND p.phone_e164 = ${phoneE164})`;
  return r.n >= CONTACT_LIMIT_PER_HOUR;
}

export function isHelpFormConfigured(env: Env): boolean {
  return (env.RATE_LIMIT_SECRET ?? "").trim().length >= 16;
}

// ---- Person -------------------------------------------------------------------

// The CRM's §12.2 rules: a hard match (same email or phone) is the person;
// a soft match still creates, flagged for review with a duplicate task.
async function findOrCreatePerson(input: HelpFormInput): Promise<string> {
  const emailNorm = input.email ? normalizeEmail(input.email) : null;
  const phoneE164 = input.phone ? normalizePhoneE164(input.phone) : null;
  const candidate = {
    fullName: input.fullName,
    emailNorm,
    phoneE164,
    companyNorm: null,
  };
  const dup = findDuplicate(candidate, await dedupeCandidates(candidate, null));
  if (dup.kind === "hard") return dup.match.id;
  const reason =
    input.phone && !phoneE164
      ? "phone_unnormalised"
      : dup.kind === "soft"
        ? `possible_duplicate_${dup.on}`
        : null;
  const [p] = await db()`
    INSERT INTO person (full_name, email, phone, phone_e164, whatsapp_e164,
                        preferred_language, needs_review, needs_review_reason)
    VALUES (${input.fullName}, ${input.email}, ${input.phone}, ${phoneE164},
            ${phoneE164}, ${input.preferredLanguage}, ${reason !== null},
            ${reason})
    RETURNING id`;
  if (dup.kind === "soft")
    await raiseDuplicateTask(
      p.id,
      { id: dup.match.id, fullName: dup.match.fullName },
      null,
    );
  await writeAudit({
    userId: null,
    action: "create",
    entity: "person",
    entityId: p.id,
    before: null,
    after: { source: "help_form" },
  });
  return p.id as string;
}

// ---- Submit -------------------------------------------------------------------

export async function submitHelpForm(
  input: HelpFormInput,
  ctx: { ip: string | null; env: Env; captcha?: CaptchaVerifier | null },
): Promise<HelpResult> {
  const captcha =
    ctx.captcha === undefined ? helpCaptcha(ctx.env) : ctx.captcha;
  if (captcha && !(await captcha(input.captchaToken, ctx.ip)))
    return { kind: "captcha_failed" };

  // A repeat of an accepted submission answers with the same ticket, before
  // any limit is spent on it.
  if (input.idempotencyKey) {
    const prev = await replay(input.idempotencyKey);
    if (prev) return { kind: "created", ticketNumber: prev, replayed: true };
  }

  if (await ipLimited(ctx.env, ctx.ip)) return { kind: "rate_limited" };
  const emailNorm = input.email ? normalizeEmail(input.email) : null;
  const phoneE164 = input.phone ? normalizePhoneE164(input.phone) : null;
  if (await contactLimited(emailNorm, phoneE164))
    return { kind: "rate_limited" };

  const [cat] = await db()`
    SELECT code, label_en FROM sales.ticket_category
    WHERE code = ${input.category} AND active`;
  if (!cat) return { kind: "unknown_category" };

  try {
    return await save(
      input,
      cat as unknown as { code: string; label_en: string },
    );
  } catch (e) {
    // The same key submitted twice at once: the loser's insert of the key
    // fails and rolls back whole; answer with the winner's ticket.
    const code = (e as { code?: string }).code;
    if (code === "23505" && input.idempotencyKey) {
      const prev = await replay(input.idempotencyKey);
      if (prev) return { kind: "created", ticketNumber: prev, replayed: true };
    }
    throw e;
  }
}

async function save(
  input: HelpFormInput,
  cat: { code: string; label_en: string },
): Promise<HelpResult> {
  return withTransaction(async () => {
    const sql = db();
    const submissionId = crypto.randomUUID();
    const key = input.idempotencyKey ?? `help:${submissionId}`;
    // Claims the key: a concurrent double submit fails here and rolls back.
    await sql`
      INSERT INTO integration_event (source, external_event_id, payload, status, processed_at)
      VALUES ('help_form', ${key}, ${sql.json({ submissionId, category: cat.code } as never)},
              'processed', now())`;

    const personId = await findOrCreatePerson(input);
    const [conv] = await sql`
      INSERT INTO sales.conversation (person_id, channel, external_thread_id,
                                      last_message_at, last_inbound_at)
      VALUES (${personId}, 'web_form', ${submissionId}, now(), now())
      RETURNING id`;
    await sql`
      INSERT INTO sales.message (conversation_id, person_id, channel, direction,
                                 external_message_id, body, status)
      VALUES (${conv.id}, ${personId}, 'web_form', 'in', ${submissionId},
              ${input.message}, 'received')`;
    const firstLine = input.message.split(/\r?\n/)[0].trim();
    const subject =
      firstLine.length > 3
        ? firstLine.length > 80
          ? `${firstLine.slice(0, 77)}…`
          : firstLine
        : `Help form: ${cat.label_en}`;
    const t = await createTicket(
      {
        personId,
        conversationId: conv.id,
        sourceChannel: "web_form",
        category: cat.code,
        subject,
      },
      null,
    );
    await sql`
      UPDATE integration_event
      SET payload = payload || ${sql.json({ ticketNumber: t.number } as never)}
      WHERE source = 'help_form' AND external_event_id = ${key}`;
    return { kind: "created", ticketNumber: t.number, replayed: false };
  });
}

async function replay(key: string): Promise<string | null> {
  const [r] = await db()`
    SELECT payload->>'ticketNumber' AS n FROM integration_event
    WHERE source = 'help_form' AND external_event_id = ${key}`;
  return (r?.n as string | undefined) ?? null;
}

// The categories a customer may pick (active ones), for the form.
export async function helpCategories(lang: "en" | "zh" = "en") {
  const rows = await db()`
    SELECT code, label_en, label_zh FROM sales.ticket_category
    WHERE active ORDER BY position, code`;
  return rows.map((r) => ({
    code: r.code as string,
    label: ((lang === "zh" && r.label_zh) || r.label_en) as string,
  }));
}
