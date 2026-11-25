import { createHmac, timingSafeEqual } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { escapeHtml, FOOTER, wrapEmail } from "./blocks.ts";

// The pure parts of email marketing: the unsubscribe token, the email body,
// and the Resend batch call. No database here, so tests run without one.

export type Language = "en" | "zh";

// ---- Unsubscribe token ------------------------------------------------------
// `<person id>.<signature>`: the signature is an HMAC of the person id, so a
// link can't be made for someone else. It never expires: an old email's
// unsubscribe link must keep working.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mac(personId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`unsubscribe:${personId}`)
    .digest("base64url");
}

export function signUnsubscribe(personId: string, secret: string): string {
  return `${personId}.${mac(personId, secret)}`;
}

// The person id, or null for a token that is malformed or wrongly signed.
export function verifyUnsubscribe(
  token: string,
  secret: string,
): string | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const personId = token.slice(0, dot).toLowerCase();
  if (!UUID.test(personId)) return null;
  const want = Buffer.from(mac(personId, secret));
  const got = Buffer.from(token.slice(dot + 1));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return personId;
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

// ---- The email --------------------------------------------------------------

const ALLOWED = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "p",
    "br",
    "hr",
    "div",
    "span",
    "blockquote",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "ul",
    "ol",
    "li",
    "a",
    "img",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    "*": ["style"],
  },
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  // Inline styles only for the basics an email needs.
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-f]{3,8}$/i],
      "background-color": [/^#[0-9a-f]{3,8}$/i],
      "text-align": [/^(left|right|center)$/],
      "font-size": [/^\d{1,2}px$/],
      // What the block editor (lib/email/blocks.ts) writes.
      "font-weight": [/^(400|600|700|bold|normal)$/],
      "line-height": [/^\d(\.\d)?$/],
      margin: [/^\d{1,2}(px)?( \d{1,2}(px)?){0,3}$/],
      padding: [/^\d{1,2}(px)?( \d{1,2}(px)?){0,3}$/],
      "border-radius": [/^\d{1,2}px$/],
      border: [/^none$/],
      "border-top": [/^1px solid #[0-9a-f]{3,8}$/i],
      display: [/^(block|inline-block)$/],
      "text-decoration": [/^(none|underline)$/],
      "max-width": [/^100%$/],
      height: [/^auto$/],
    },
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
} satisfies sanitizeHtml.IOptions;

// What a person writes in the editor, made safe to store and to send.
export function cleanBody(html: string): string {
  return sanitizeHtml(html, ALLOWED);
}

const FALLBACK_NAME: Record<Language, string> = { en: "there", zh: "您" };

export type Rendered = { html: string; text: string };

// `{{name}}` becomes the person's name. The unsubscribe footer is always
// added: a campaign can't leave it out.
export function renderCampaign(opts: {
  bodyHtml: string;
  name: string | null;
  language: Language;
  unsubscribeUrl: string;
}): Rendered {
  const name = escapeHtml(opts.name?.trim() || FALLBACK_NAME[opts.language]);
  const body = cleanBody(opts.bodyHtml).replace(/\{\{\s*name\s*\}\}/g, name);
  const f = FOOTER[opts.language];
  const html = wrapEmail(body, { ...f, url: opts.unsubscribeUrl });
  const text =
    sanitizeHtml(
      body
        // A link keeps its address in the text version: "Register (https://…)".
        .replace(
          /<a\b[^>]*\bhref="(https:[^"]+)"[^>]*>([^<]*)<\/a>/gi,
          (_m, href: string, words: string) =>
            words.trim() && words.trim() !== href ? `${words} (${href})` : href,
        )
        .replace(/<\/(p|div|h[1-3]|li)>|<br\s*\/?>/gi, "\n"),
      {
        allowedTags: [],
        allowedAttributes: {},
      },
    )
      .replace(/\n{3,}/g, "\n\n")
      .trim() + `\n\n--\n${f.why}\n${f.link}: ${opts.unsubscribeUrl}\n`;
  return { html, text };
}

// ---- Resend batch -----------------------------------------------------------
// POST /emails/batch takes up to 100 emails in one request.

export const BATCH_SIZE = 100;

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
};

export type BatchResult =
  | { ok: true }
  // `retry`: worth another attempt later (Resend busy or unreachable).
  | { ok: false; error: string; retry: boolean };

export async function sendBatch(opts: {
  apiKey: string;
  from: string;
  emails: OutgoingEmail[];
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<BatchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": opts.idempotencyKey,
      },
      body: JSON.stringify(
        opts.emails.map((e) => ({
          from: opts.from,
          to: [e.to],
          subject: e.subject,
          html: e.html,
          text: e.text,
          headers: {
            "List-Unsubscribe": `<${e.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        })),
      ),
    });
  } catch {
    return { ok: false, error: "Resend unreachable", retry: true };
  }
  if (res.ok) return { ok: true };
  // Status only: Resend's error body can echo an address.
  return {
    ok: false,
    error: `Resend answered ${res.status}`,
    retry: res.status === 429 || res.status >= 500,
  };
}
