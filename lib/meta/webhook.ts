import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../sql.ts";
import {
  captureMetaLead,
  metaLeadSchema,
  type MetaLeadInput,
} from "./intake.ts";

// Meta Lead Ads: the webhook and the fetch of each lead's answers
// (docs/specs/2026-11-04-meta-lead-ads-intake.md §3).
//
//   1. Meta POSTs a "leadgen" notice: ids only (lead, form, ad, page).
//   2. Each lead id is recorded once in integration_event (source
//      'meta_leadgen'), so a repeated notice never runs twice.
//   3. The lead's answers are read from the Graph API, mapped to the CRM's
//      lead fields (standard questions, plus the form's custom questions from
//      sales.meta_form) and saved by captureMetaLead(): the CRM's own dedupe,
//      consent and deal rules.
//   4. A failure waits and is tried again by `npm run meta:run`; after the
//      last try, or at once when the answers can't make a lead (no email and
//      no phone), marketing get a task so no lead is lost.
//
// CHECKED (4 Nov) only through search results, because Meta's developer
// site was not reachable from where this was written: the hub.* handshake,
// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body), the
// `leadgen_id` in the notice, `field_data` in the lead, and the
// `leads_retrieval` permission. FROM MEMORY, to check with Meta's lead ads
// testing tool before go-live: the notice's other key names (form_id, ad_id,
// page_id, created_time), the lead fields `campaign_id` and `platform`, the
// standard question keys (full_name, email, phone_number, …) and `platform`
// values "fb"/"ig". If Meta rejects the extra lead fields, the fetch falls
// back to the confirmed ones (see fetchLead).

export const SOURCE = "meta_leadgen";
export const MAX_ATTEMPTS = 5;
export const BACKOFF_SECONDS = [60, 300, 1800, 7200];
// Meta's own examples use v25.0 (Nov 2026). Override with META_GRAPH_VERSION.
export const DEFAULT_GRAPH_VERSION = "v25.0";
const LEASE_SECONDS = 300;

// ---- Subscription handshake (GET) --------------------------------------------

// Meta checks the endpoint once, when the webhook is set up: answer with the
// challenge only when the verify token is ours.
export function subscriptionChallenge(
  params: URLSearchParams,
  verifyToken: string,
): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const given = Buffer.from(params.get("hub.verify_token") ?? "");
  const want = Buffer.from(verifyToken);
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return null;
  return params.get("hub.challenge");
}

// ---- Signature (POST) --------------------------------------------------------

// "sha256=<hex>" of the raw body, keyed with the app secret. There is no
// timestamp, so a captured delivery could be replayed; the one-row-per-lead
// claim below makes a replay do nothing.
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---- Notices -----------------------------------------------------------------

export type LeadNotice = {
  leadgenId: string;
  formId: string | null;
  adId: string | null;
  pageId: string | null;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0
    ? v
    : typeof v === "number"
      ? String(v)
      : null;

// Graph ids are digits; anything else is not used in a URL.
const isGraphId = (s: string) => /^\d{1,30}$/.test(s);

// { object: "page", entry: [{ changes: [{ field: "leadgen", value: {...} }] }] }
export function leadNotices(body: unknown): LeadNotice[] {
  const out: LeadNotice[] = [];
  const entries = (body as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    const changes = (e as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const ch = c as { field?: unknown; value?: Record<string, unknown> };
      if (ch?.field !== "leadgen" || !ch.value) continue;
      const leadgenId = str(ch.value.leadgen_id);
      if (!leadgenId || !isGraphId(leadgenId)) continue;
      out.push({
        leadgenId,
        formId: str(ch.value.form_id),
        adId: str(ch.value.ad_id),
        pageId: str(ch.value.page_id),
      });
    }
  }
  return out;
}

// Records each notice once. Returns the lead ids that are new, so the
// webhook can try them straight away; repeats are left alone.
export async function recordNotices(notices: LeadNotice[]): Promise<string[]> {
  const sql = db();
  const fresh: string[] = [];
  for (const n of notices) {
    const [row] = await sql`
      INSERT INTO integration_event (source, external_event_id, payload)
      VALUES (${SOURCE}, ${n.leadgenId}, ${sql.json(n as never)})
      ON CONFLICT (source, external_event_id) DO NOTHING
      RETURNING id`;
    if (row) fresh.push(n.leadgenId);
  }
  return fresh;
}

// ---- The lead's answers ------------------------------------------------------

export type MetaLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  campaign_id?: string;
  platform?: string;
  field_data?: { name?: string; values?: unknown[] }[];
};

export type MetaDeps = {
  accessToken: string; // META_PAGE_ACCESS_TOKEN, with leads_retrieval
  graphVersion?: string;
  fetchImpl?: typeof fetch;
};

export const CONFIRMED_FIELDS = "id,created_time,ad_id,form_id,field_data";
export const LEAD_FIELDS = `${CONFIRMED_FIELDS},campaign_id,platform`;

class GraphError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null) {
    super(message);
    this.code = code;
  }
}

async function graphGet(
  leadgenId: string,
  fields: string,
  deps: MetaDeps,
): Promise<MetaLead> {
  const url = new URL(
    `https://graph.facebook.com/${deps.graphVersion ?? DEFAULT_GRAPH_VERSION}/${leadgenId}`,
  );
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", deps.accessToken);
  const res = await (deps.fetchImpl ?? fetch)(url, {
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as MetaLead & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok || body.error)
    // Meta's message only: the URL holds the token and is never logged.
    throw new GraphError(
      `Graph API ${res.status}: ${body.error?.message ?? "no message"}`.slice(
        0,
        300,
      ),
      body.error?.code ?? null,
    );
  return body;
}

export async function fetchLead(
  leadgenId: string,
  deps: MetaDeps,
): Promise<MetaLead> {
  if (!isGraphId(leadgenId)) throw new Error("not a Meta lead id");
  try {
    return await graphGet(leadgenId, LEAD_FIELDS, deps);
  } catch (e) {
    // Code 100 is Graph's "invalid parameter": if campaign_id or platform
    // is not a lead field, read the confirmed fields instead of failing.
    if (e instanceof GraphError && e.code === 100)
      return graphGet(leadgenId, CONFIRMED_FIELDS, deps);
    throw e;
  }
}

// ---- Mapping -----------------------------------------------------------------

// The CRM lead fields a form's custom question may fill.
export const MAPPABLE = [
  "courseInterest",
  "hrdcIntended",
  "consentMarketing",
  "preferredLanguage",
  "classCode",
  "message",
  "companyName",
  "jobTitle",
] as const;
export type FormMap = { name: string | null; fields: Record<string, string> };

const formMapSchema = z.record(z.string(), z.enum(MAPPABLE));

const yes = (v: string) => /^(yes|ya|y|true|1|是)\b/i.test(v.trim());
const language = (v: string) =>
  /chinese|mandarin|中文|华语|zh/i.test(v) ? "zh" : "en";

export function mapLead(lead: MetaLead, form: FormMap | null): MetaLeadInput {
  const answers = new Map<string, string>();
  for (const f of lead.field_data ?? []) {
    const v = (f.values ?? [])
      .map((x) => String(x))
      .join(", ")
      .trim();
    if (f.name && v) answers.set(f.name.toLowerCase(), v);
  }
  const a = (...keys: string[]) =>
    keys.map((k) => answers.get(k)).find(Boolean) ?? null;

  const custom: Record<string, unknown> = {};
  const map = formMapSchema.safeParse(form?.fields ?? {});
  for (const [question, field] of Object.entries(map.success ? map.data : {})) {
    const v = answers.get(question.toLowerCase());
    if (!v) continue;
    if (field === "hrdcIntended" || field === "consentMarketing")
      custom[field] = yes(v);
    else if (field === "preferredLanguage") custom[field] = language(v);
    else custom[field] = v;
  }

  const fullName =
    a("full_name") ??
    ([a("first_name"), a("last_name")].filter(Boolean).join(" ") || "");
  const formId = lead.form_id ?? null;

  return metaLeadSchema.parse({
    fullName,
    email: a("email", "work_email"),
    phone: a("phone_number", "work_phone_number"),
    companyName: a("company_name"),
    jobTitle: a("job_title"),
    ...custom,
    formName:
      form?.name ?? (formId ? `Meta lead form ${formId}` : "Meta lead form"),
    idempotencyKey: `meta-leadgen:${lead.id}`,
    campaignId: lead.campaign_id ?? null,
    adId: lead.ad_id ?? null,
    attribution: {
      utmSource: lead.platform === "ig" ? "instagram" : "facebook",
      utmCampaign: lead.campaign_id ?? null,
    },
  });
}

async function formMap(formId: string | null): Promise<FormMap | null> {
  if (!formId) return null;
  const [f] = await db()`
    SELECT name, fields FROM sales.meta_form WHERE form_id = ${formId}`;
  return f ? { name: f.name, fields: f.fields } : null;
}

// ---- Processing --------------------------------------------------------------

export type ProcessResult =
  | { kind: "saved"; personId: string; dealId: string; replayed: boolean }
  | { kind: "busy" }
  | { kind: "failed"; final: boolean; error: string };

// A lead the answers can't make (zod rejects it): trying again won't help.
class NotALead extends Error {}

// Takes the row for a few minutes, so the webhook and meta:run never fetch
// the same lead at once (captureLead's idempotency key would still stop a
// second person or deal).
async function lease(leadgenId: string) {
  const [row] = await db()`
    UPDATE integration_event
    SET next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        updated_at = now()
    WHERE source = ${SOURCE} AND external_event_id = ${leadgenId}
      AND status IN ('received','failed') AND attempts < ${MAX_ATTEMPTS}
      AND next_attempt_at <= now()
    RETURNING id, attempts, payload`;
  return row as
    { id: string; attempts: number; payload: LeadNotice } | undefined;
}

export async function processLead(
  leadgenId: string,
  deps: MetaDeps,
): Promise<ProcessResult> {
  const row = await lease(leadgenId);
  if (!row) return { kind: "busy" };
  const sql = db();
  try {
    const lead = await fetchLead(leadgenId, deps);
    let input: MetaLeadInput;
    try {
      input = mapLead(
        {
          ...lead,
          form_id: lead.form_id ?? row.payload.formId ?? undefined,
          ad_id: lead.ad_id ?? row.payload.adId ?? undefined,
        },
        await formMap(lead.form_id ?? row.payload.formId),
      );
    } catch (e) {
      const issues =
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : String(e);
      throw new NotALead(`The form answers can't make a lead: ${issues}`);
    }
    const r = await captureMetaLead(input);
    await sql`
      UPDATE integration_event
      SET status = 'processed', processed_at = now(), error = NULL,
          attempts = attempts + 1, updated_at = now()
      WHERE id = ${row.id}`;
    return { kind: "saved", ...r };
  } catch (e) {
    // The message only: a database error's detail can hold an email.
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const attempts = row.attempts + 1;
    const final = e instanceof NotALead || attempts >= MAX_ATTEMPTS;
    await sql`
      UPDATE integration_event
      SET status = 'failed', processed_at = now(), error = ${error},
          attempts = ${final ? MAX_ATTEMPTS : attempts},
          next_attempt_at = now() + make_interval(secs => ${
            final ? 0 : BACKOFF_SECONDS[attempts - 1]
          }),
          updated_at = now()
      WHERE id = ${row.id}`;
    if (final) await lostLeadTask(leadgenId, row.payload, error);
    return { kind: "failed", final, error };
  }
}

// Marketing own the lead forms; the duty super_admin when no one is in
// marketing.
async function lostLeadTask(leadgenId: string, n: LeadNotice, error: string) {
  const sql = db();
  const [owner] = await sql`
    SELECT id FROM app_user
    WHERE is_active AND role_code IN ('marketing','super_admin')
    ORDER BY role_code = 'marketing' DESC, created_at, id
    LIMIT 1`;
  await sql`
    INSERT INTO task (type, title, assigned_user_id, due_at, notes, source_key)
    VALUES ('other', 'A Meta lead could not be saved',
            ${owner?.id ?? null}, now(),
            ${`Lead ${leadgenId} (form ${n.formId ?? "unknown"}) from a Facebook or Instagram lead form was not saved: ${error}. Find it in Meta's Leads Center and add it by hand, or fix the cause and retry.`},
            ${`meta-lead:${leadgenId}:lost`})
    ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING`;
}

// Every lead due a try: new ones the webhook couldn't finish, and failures
// whose wait is over.
export async function runMetaQueue(
  deps: MetaDeps,
  batch = 50,
): Promise<{ saved: number; failed: number; lost: number }> {
  const due = await db()`
    SELECT external_event_id FROM integration_event
    WHERE source = ${SOURCE} AND status IN ('received','failed')
      AND attempts < ${MAX_ATTEMPTS} AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    LIMIT ${batch}`;
  const out = { saved: 0, failed: 0, lost: 0 };
  for (const d of due) {
    const r = await processLead(d.external_event_id as string, deps);
    if (r.kind === "saved") out.saved++;
    else if (r.kind === "failed") out[r.final ? "lost" : "failed"]++;
  }
  return out;
}

export function metaDepsFromEnv(): MetaDeps | null {
  const accessToken = (process.env.META_PAGE_ACCESS_TOKEN ?? "").trim();
  if (!accessToken) return null;
  return {
    accessToken,
    graphVersion:
      (process.env.META_GRAPH_VERSION ?? "").trim() || DEFAULT_GRAPH_VERSION,
  };
}
