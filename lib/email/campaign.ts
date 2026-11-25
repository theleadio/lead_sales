import { createHmac, timingSafeEqual } from "node:crypto";
import sanitizeHtml from "sanitize-html";

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

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FALLBACK_NAME: Record<Language, string> = { en: "there", zh: "您" };
const FOOTER: Record<Language, { why: string; link: string }> = {
  en: {
    why: "You are receiving this because you agreed to hear from LEAD.",
    link: "Unsubscribe",
  },
  zh: { why: "您收到此邮件是因为您同意接收 LEAD 的资讯。", link: "退订" },
};

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
  const url = escapeHtml(opts.unsubscribeUrl);
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1d1d1f">${body}` +
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px">` +
    `<p style="font-size:12px;color:#6e6e73">${f.why} <a href="${url}">${f.link}</a></p></div>`;
  const text =
    sanitizeHtml(body.replace(/<\/(p|div|h[1-3]|li)>|<br\s*\/?>/gi, "\n"), {
      allowedTags: [],
      allowedAttributes: {},
    })
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
