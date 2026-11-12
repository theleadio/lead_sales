import { Final, type Sender } from "../automations/run.ts";
import { db, outsideTransaction, withTransaction } from "../sql.ts";

// The automations engine's WhatsApp Sender: an approved WATI template, by the
// name the step gives (and its Chinese one for a Chinese run). Wording lives
// in WATI. Kept here from PR #21 when the inbox, the WATI webhook and inbox
// replies moved to lead_crm (its migrations 019 and 020): automations run
// here, so their sends do too.
//
// Never twice. The message is saved in the CRM's inbox (`conversation`,
// `conversation_message`, ground rule 4) as `queued` BEFORE WATI is called,
// in its own committed transaction outside the run's, under the engine's
// per-run, per-step key. That key also goes to WATI as local_message_id.
//  - a retry finds the row and does not send again (run.ts "Already sent")
//  - the CRM's webhook can see the row while the run is still going
//  - WATI refusing it (4xx, result:false, a bad host) marks it `failed` and
//    stops the run at once with the reason; "run again" may then resend
//  - WATI busy (429, 408) marks it `failed` and lets the engine retry it
//    with its usual backoff: it was not sent, so sending again is safe
//  - no clear answer (timeout, 5xx, network) leaves it `queued` and stops the
//    run: WATI may have sent it, so it is not sent again automatically
//
// Check on the first real send: that WATI echoes local_message_id on
// template events. If it does not, the CRM webhook saves the echo as a
// second message (lead_crm lib/wati/webhook.ts adopts only inbox replies).
//
// API v3, host only, Bearer token. Errors carry the status only: a body can
// echo the phone number. Needs a pool of 2+ connections (the scheduled
// script's; not a one-connection Lambda pool): see outsideTransaction().

export type WatiOpts = {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
};

// WATI said no: retrying cannot help.
class Refused extends Error {}

// WATI is busy (429 rate limit, 408 timeout reading the request): not sent,
// and the same message can go again shortly. Not the template's fault.
class Busy extends Error {}

async function sendTemplate(
  o: WatiOpts,
  to: string,
  template: string,
  localId: string,
  params: { name: string; value: string }[],
): Promise<void> {
  let origin: string;
  try {
    origin = new URL(o.host).origin;
  } catch {
    throw new Refused("WATI_API_HOST is not a valid address");
  }
  const res = await (o.fetchImpl ?? fetch)(
    origin + "/api/ext/v3/messageTemplates/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${o.token.replace(/^Bearer\s+/i, "")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_name: template,
        broadcast_name: `${template}-${new Date().toISOString().slice(0, 10)}`,
        recipients: [
          { target: to, local_message_id: localId, custom_params: params },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (res.status === 408 || res.status === 429)
    throw new Busy(`WATI is busy (${res.status})`);
  if (res.status >= 400 && res.status < 500)
    throw new Refused(
      `WATI refused it (${res.status}): check the template name and that it is approved`,
    );
  if (!res.ok) throw new Error(`WATI answered ${res.status}`);
  // WATI can answer 200 with result:false.
  const json = (await res.json().catch(() => null)) as {
    result?: unknown;
  } | null;
  if (json && json.result === false)
    throw new Refused(
      "WATI refused the message: check the template name, that it is approved, and the number",
    );
}

// The name for the greeting: the preferred or full name, unless all the CRM
// has is the number (a WhatsApp sender with no profile name is saved with
// the number as their name, flagged no_name). Never empty: WATI may refuse
// an empty parameter.
async function greetingName(personId: string): Promise<string> {
  const [p] = await db()`
    SELECT preferred_name, full_name, needs_review_reason FROM person
    WHERE id = ${personId}`;
  const name = (p?.preferred_name ?? p?.full_name ?? "").trim();
  if (!name || p?.needs_review_reason === "no_name" || !/\p{L}/u.test(name))
    return "there";
  return name;
}

// Saves the message as `queued`, committed now. True when this call claimed
// it (new, or a failed one being sent again), false when an earlier attempt
// already did: then it is not sent again.
async function claim(
  personId: string,
  e164: string,
  key: string,
  body: string,
): Promise<boolean> {
  return outsideTransaction(() =>
    withTransaction(async () => {
      const sql = db();
      // The CRM webhook's lock for this number: a message landing at the same
      // moment can't make a second thread.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`wati:${e164}`}))`;
      // Thread id = the number's digits, as the CRM's webhook and history
      // import use. A thread that exists keeps its person: the message goes
      // to that person, so a thread never holds two people's messages.
      const [c] = await sql`
        INSERT INTO conversation (person_id, channel, external_thread_id,
                                  last_message_at)
        VALUES (${personId}, 'whatsapp', ${e164.slice(1)}, clock_timestamp())
        ON CONFLICT (channel, external_thread_id) DO UPDATE
          SET last_message_at = greatest(conversation.last_message_at,
                                         EXCLUDED.last_message_at)
        RETURNING id, person_id`;
      const [added] = await sql`
        INSERT INTO conversation_message (conversation_id, person_id, channel,
          direction, external_message_id, body, status)
        VALUES (${c.id}, ${c.person_id}, 'whatsapp', 'out', ${key}, ${body},
                'queued')
        ON CONFLICT (channel, external_message_id) DO UPDATE
          SET status = 'queued', body = EXCLUDED.body
          WHERE conversation_message.status = 'failed'
        RETURNING id`;
      return Boolean(added);
    }),
  );
}

const setStatus = (key: string, to: "sent" | "failed") =>
  outsideTransaction(
    () => db()`
      UPDATE conversation_message SET status = ${to}
      WHERE channel = 'whatsapp' AND external_message_id = ${key}
        AND status = 'queued'`,
  );

export function watiSender(o: WatiOpts): Sender {
  return async (req) => {
    const e164 = `+${req.to.replace(/\D/g, "")}`;
    // The same shape as the CRM webhook's echo of a template.
    const body = `[template ${req.template}]`;
    if (!(await claim(req.personId, e164, req.idempotencyKey, body))) return;
    try {
      await sendTemplate(o, e164.slice(1), req.template, req.idempotencyKey, [
        { name: "name", value: await greetingName(req.personId) },
      ]);
    } catch (e) {
      if (e instanceof Busy) {
        // Not sent: freed for the engine's retry (claim() takes a failed
        // row back), which waits 1 min, 5 min, … before trying again.
        await setStatus(req.idempotencyKey, "failed");
        throw new Error(
          `${e.message}: not sent; it is tried again automatically`,
        );
      }
      if (e instanceof Refused) {
        await setStatus(req.idempotencyKey, "failed");
        throw new Final(e.message);
      }
      // Kept `queued`: WATI may have sent it.
      throw new Final(
        `WATI gave no clear answer (${e instanceof Error ? e.message : String(e)}): not sent again, in case it went out. Check the chat in WATI.`,
      );
    }
    await setStatus(req.idempotencyKey, "sent");
  };
}

// From env, or none (the engine then logs "not connected").
export function watiFromEnv(): WatiOpts | undefined {
  const host = process.env.WATI_API_HOST;
  const token = process.env.WATI_API_TOKEN;
  return host && token ? { host, token } : undefined;
}
