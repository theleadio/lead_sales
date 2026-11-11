import type { Sender } from "../automations/run.ts";
import { db } from "../sql.ts";

// The automations engine's WhatsApp Sender: an approved WATI template, by the
// name typed in the step as it is in WATI (no -en/-zh suffix: the step names
// the template it wants). Wording lives in WATI. Kept here from PR #21 when
// the inbox, the WATI webhook and inbox replies moved to lead_crm (its
// migrations 019 and 020): automations run here, so their sends do too.
//
// The sent message is saved in the CRM's inbox (`conversation`,
// `conversation_message`, ground rule 4) under the engine's per-run,
// per-step key, which also goes to WATI as local_message_id: the CRM's
// webhook then moves its status on, and the engine's "already sent" check
// finds it. API v3, host only, Bearer token. Errors carry the status only: a
// body can echo the phone number.

export type WatiOpts = {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
};

async function sendTemplate(
  o: WatiOpts,
  to: string,
  template: string,
  localId: string,
  params: { name: string; value: string }[],
): Promise<void> {
  const res = await (o.fetchImpl ?? fetch)(
    new URL(o.host).origin + "/api/ext/v3/messageTemplates/send",
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
  if (!res.ok) throw new Error(`WATI answered ${res.status}`);
  // WATI can answer 200 with result:false.
  const json = (await res.json().catch(() => null)) as {
    result?: unknown;
  } | null;
  if (json && json.result === false)
    throw new Error("WATI refused the message");
}

export function watiSender(o: WatiOpts): Sender {
  return async (req) => {
    const [p] = await db()`
      SELECT coalesce(preferred_name, full_name) AS name FROM person
      WHERE id = ${req.personId}`;
    const digits = req.to.replace(/\D/g, "");
    await sendTemplate(o, digits, req.template, req.idempotencyKey, [
      { name: "name", value: String(p?.name ?? "") },
    ]);
    // Saved after the send, so a failed send is retried by the engine and not
    // skipped as "already sent". Thread id = the WhatsApp number's digits, as
    // the CRM's webhook and history import use.
    // ponytail: a status event that beats this insert (milliseconds) would
    // save the message a second time; match on local_message_id if seen.
    const [c] = await db()`
      INSERT INTO conversation (person_id, channel, external_thread_id)
      VALUES (${req.personId}, 'whatsapp', ${digits})
      ON CONFLICT (channel, external_thread_id) DO UPDATE
        SET person_id = conversation.person_id
      RETURNING id`;
    await db()`
      INSERT INTO conversation_message (conversation_id, person_id, channel,
        direction, external_message_id, body, status)
      VALUES (${c.id}, ${req.personId}, 'whatsapp', 'out',
              ${req.idempotencyKey}, ${`[template] ${req.template}`}, 'sent')
      ON CONFLICT (channel, external_message_id) DO NOTHING`;
    await db()`
      UPDATE conversation SET last_message_at = now() WHERE id = ${c.id}`;
  };
}

// From env, or none (the engine then logs "not connected").
export function watiFromEnv(): WatiOpts | undefined {
  const host = process.env.WATI_API_HOST;
  const token = process.env.WATI_API_TOKEN;
  return host && token ? { host, token } : undefined;
}
