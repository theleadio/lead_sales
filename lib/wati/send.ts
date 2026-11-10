import type { Sender } from "../automations/run.ts";
import { conversationDetail, replyWindow } from "../inbox/service.ts";
import { db } from "../sql.ts";
import { TicketError, type Actor } from "../tickets/service.ts";

// Sending through WATI API v3 (docs.wati.io): free text inside the 24-hour
// window, an approved template outside it. Host only, Bearer token. Errors
// carry the status only: a body can echo the phone number.
//
// Every message we send is saved as `out` in the inbox with an id of our own.
// For templates that id goes to WATI as local_message_id, so the status
// events the webhook receives (lib/wati/webhook.ts) can find the same row.

export type WatiOpts = {
  host: string;
  token: string;
  fetchImpl?: typeof fetch;
};

async function post(o: WatiOpts, path: string, body: unknown): Promise<void> {
  const res = await (o.fetchImpl ?? fetch)(new URL(o.host).origin + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${o.token.replace(/^Bearer\s+/i, "")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`WATI answered ${res.status}`);
  // WATI can answer 200 with result:false.
  const json = (await res.json().catch(() => null)) as {
    result?: unknown;
  } | null;
  if (json && json.result === false)
    throw new Error("WATI refused the message");
}

const sendText = (o: WatiOpts, to: string, text: string) =>
  post(o, "/api/ext/v3/conversations/messages/text", { target: to, text });

const sendTemplate = (
  o: WatiOpts,
  to: string,
  template: string,
  localId: string,
  params: { name: string; value: string }[],
) =>
  post(o, "/api/ext/v3/messageTemplates/send", {
    template_name: template,
    broadcast_name: `${template}-${new Date().toISOString().slice(0, 10)}`,
    recipients: [
      { target: to, local_message_id: localId, custom_params: params },
    ],
  });

// The conversation for this person's WhatsApp number (thread id = digits, as
// the webhook and the history import use), created on the first message.
async function conversationFor(personId: string, e164: string) {
  const [c] = await db()`
    INSERT INTO sales.conversation (person_id, channel, external_thread_id)
    VALUES (${personId}, 'whatsapp', ${e164.replace(/\D/g, "")})
    ON CONFLICT (channel, external_thread_id) DO UPDATE
      SET person_id = sales.conversation.person_id
    RETURNING id`;
  return c.id as string;
}

async function saveOut(
  conversationId: string,
  personId: string,
  ext: string,
  body: string,
  status: "queued" | "sent",
  userId: string | null,
) {
  await db()`
    INSERT INTO sales.message (conversation_id, person_id, channel, direction,
                               external_message_id, body, status, sent_by_user_id)
    VALUES (${conversationId}, ${personId}, 'whatsapp', 'out', ${ext}, ${body},
            ${status}, ${userId})
    ON CONFLICT (channel, external_message_id) DO NOTHING`;
  await db()`
    UPDATE sales.conversation SET last_message_at = now()
    WHERE id = ${conversationId}`;
}

// The automations engine's WhatsApp Sender: a template, by the name typed in
// the step as it is in WATI (no -en/-zh suffix: the step names the approved
// template it wants). Wording lives in WATI. The engine's per-run, per-step
// key is our id for the message.
export function watiSender(o: WatiOpts): Sender {
  return async (req) => {
    const [p] = await db()`
      SELECT coalesce(preferred_name, full_name) AS name FROM person
      WHERE id = ${req.personId}`;
    await sendTemplate(
      o,
      req.to.replace(/\D/g, ""),
      req.template,
      req.idempotencyKey,
      [{ name: "name", value: String(p?.name ?? "") }],
    );
    // Saved after the send, so a failed send is retried by the engine and not
    // skipped as "already sent".
    // ponytail: a status event that beats this insert (milliseconds) would
    // save the message a second time; match on local_message_id if seen.
    const conv = await conversationFor(req.personId, req.to);
    await saveOut(
      conv,
      req.personId,
      req.idempotencyKey,
      `[template] ${req.template}`,
      "sent",
      null,
    );
  };
}

// A reply typed in the inbox. Only inside the free-reply window.
export async function sendInboxReply(
  o: WatiOpts,
  actor: Actor,
  conversationId: string,
  text: string,
): Promise<void> {
  const body = text.trim();
  if (!body || body.length > 4000)
    throw new TicketError("invalid", "Empty or too long.");
  // Only a conversation this user may open (an unseen one is audited there).
  if (!(await conversationDetail(actor, conversationId)))
    throw new TicketError("not_found", "No such WhatsApp conversation.");
  const [c] = await db()`
    SELECT person_id, channel, external_thread_id, last_inbound_at
    FROM sales.conversation WHERE id = ${conversationId}`;
  if (!c || c.channel !== "whatsapp")
    throw new TicketError("not_found", "No such WhatsApp conversation.");
  if (replyWindow("whatsapp", c.last_inbound_at) !== "open")
    throw new TicketError("invalid", "The free-reply window has closed.");
  const ext = `app:${crypto.randomUUID()}`;
  await saveOut(conversationId, c.person_id, ext, body, "queued", actor.id);
  try {
    await sendText(o, c.external_thread_id, body);
  } catch {
    await db()`
      UPDATE sales.message SET status = 'failed'
      WHERE channel = 'whatsapp' AND external_message_id = ${ext}`;
    throw new TicketError("send_failed", "WATI did not accept the message.");
  }
  await db()`
    UPDATE sales.message SET status = 'sent'
    WHERE channel = 'whatsapp' AND external_message_id = ${ext}`;
}

// From env, or none (the engine then logs "not connected").
export function watiFromEnv(): WatiOpts | undefined {
  const host = process.env.WATI_API_HOST;
  const token = process.env.WATI_API_TOKEN;
  return host && token ? { host, token } : undefined;
}
