import type { Sender } from "../automations/run.ts";
import { db } from "../sql.ts";

// The automations engine's email Sender, through Resend (WP2, decided 5 Nov).
// Wording lives in Resend's hosted templates, not here: an automation's
// template "onboarding" sends the Resend template `onboarding-en` or
// `onboarding-zh`, the language the engine picked (the class's, else the
// person's). Variables are filled from the CRM; empty ones are left out.
//
// The engine's per-run, per-step key goes as Resend's Idempotency-Key, so a
// retry inside Resend's 24-hour window can't send twice. Any non-2xx throws:
// the engine retries with backoff, then fails the run with this message.

export const LMS_URL = "https://class.thelead.io/";

async function variables(
  personId: string,
  context: Record<string, unknown>,
  language: "en" | "zh",
): Promise<Record<string, string>> {
  const sql = db();
  // No first-name guess: in "Tan Mei Ling" the first word is the surname.
  const [p] = await sql`
    SELECT coalesce(preferred_name, full_name) AS name FROM person
    WHERE id = ${personId}`;
  const v: Record<string, string | null | undefined> = {
    name: p?.name,
    lms_url: LMS_URL,
  };
  if (typeof context.classId === "string") {
    const [c] = await sql`
      SELECT c.code, c.start_date::text AS start_date,
             to_char(c.start_time, 'HH24:MI') AS start_time,
             c.venue_name, c.online_url, co.name_en, co.name_zh
      FROM class c JOIN course co ON co.id = c.course_id
      WHERE c.id = ${context.classId}`;
    if (c)
      Object.assign(v, {
        course_name: language === "zh" ? (c.name_zh ?? c.name_en) : c.name_en,
        class_code: c.code,
        start_date: c.start_date,
        start_time: c.start_time,
        venue: c.venue_name,
        online_url: c.online_url,
      });
  }
  return Object.fromEntries(
    Object.entries(v).filter((e): e is [string, string] => Boolean(e[1])),
  );
}

export function resendSender(opts: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): Sender {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (req) => {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": req.idempotencyKey,
      },
      body: JSON.stringify({
        from: opts.from,
        to: [req.to],
        template: {
          id: `${req.template}-${req.language}`,
          variables: await variables(req.personId, req.context, req.language),
        },
      }),
    });
    // Status only: Resend's error body can echo the address.
    if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  };
}

// The sender from env, or none (the engine then logs "not connected").
export function resendFromEnv(): Sender | undefined {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return apiKey && from ? resendSender({ apiKey, from }) : undefined;
}
