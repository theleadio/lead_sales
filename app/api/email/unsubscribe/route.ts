import type { NextRequest } from "next/server";
import { verifyUnsubscribe } from "@/lib/email/campaign";
import { unsubscribe } from "@/lib/email/marketing";

// GET/POST /api/email/unsubscribe?t=<token> — the link in every newsletter.
// Public: the signed token (lib/email/campaign.ts) is the only credential.
//
// GET only shows a confirm button, because mail scanners open every link in
// an email and must not unsubscribe anyone. The button, or a mail app's
// one-click unsubscribe (RFC 8058, List-Unsubscribe-Post), is a POST, which
// withdraws `marketing_email` consent. Safe to repeat.

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex"><title>${title}</title></head>` +
      `<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1d1d1f">${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

function personFrom(request: NextRequest): string | null | undefined {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!secret) return undefined; // not configured
  const t = request.nextUrl.searchParams.get("t") ?? "";
  return verifyUnsubscribe(t, secret);
}

const BAD = page(
  "Link not valid",
  "<h1>This link isn't valid</h1><p>该链接无效。</p>",
  400,
);

export async function GET(request: NextRequest) {
  const personId = personFrom(request);
  if (personId === undefined)
    return page("Unavailable", "<p>Unavailable.</p>", 503);
  if (!personId) return BAD;
  const t = encodeURIComponent(request.nextUrl.searchParams.get("t") ?? "");
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe from LEAD emails?</h1><p>取消订阅 LEAD 的推广邮件？</p>` +
      `<form method="post" action="/api/email/unsubscribe?t=${t}">` +
      `<button type="submit" style="font-size:1rem;padding:.6rem 1.2rem;border-radius:.5rem;border:0;background:#3d3d3d;color:#fff;cursor:pointer">Unsubscribe / 退订</button></form>`,
  );
}

export async function POST(request: NextRequest) {
  const personId = personFrom(request);
  if (personId === undefined)
    return page("Unavailable", "<p>Unavailable.</p>", 503);
  if (!personId) return BAD;
  await unsubscribe(personId);
  return page(
    "Unsubscribed",
    "<h1>You're unsubscribed</h1><p>You won't get promotional emails from LEAD any more. Class and payment emails you have asked for still reach you.</p>" +
      "<p>您已退订。您仍会收到与课程和付款相关的邮件。</p>",
  );
}
