import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/errors";
import {
  leadNotices,
  metaDepsFromEnv,
  processLead,
  recordNotices,
  subscriptionChallenge,
  verifyMetaSignature,
} from "@/lib/meta/webhook";

// Meta Lead Ads webhook (docs/specs/2026-11-04-meta-lead-ads-intake.md §3).
//
// GET: Meta's one-time check when the webhook is set up (META_VERIFY_TOKEN).
// POST: "leadgen" notices, signed with the app secret (META_APP_SECRET);
// the signature is checked against the raw body before anything else.
//
// Once a notice is recorded the answer is 200, even if fetching the lead
// failed: the failure is kept in integration_event and `npm run meta:run`
// tries it again, so Meta doesn't need to redeliver. A 5xx only when the
// notice could not be recorded at all, so Meta sends it again.
export async function GET(request: NextRequest) {
  const challenge = subscriptionChallenge(
    request.nextUrl.searchParams,
    (process.env.META_VERIFY_TOKEN ?? "").trim(),
  );
  if (challenge === null)
    return apiError(403, "bad_verify_token", "Verification failed.");
  return new Response(challenge, {
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(request: NextRequest) {
  const appSecret = (process.env.META_APP_SECRET ?? "").trim();
  if (!appSecret)
    return apiError(503, "not_configured", "Meta webhook is not configured.");

  const raw = await request.text();
  if (
    !verifyMetaSignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      appSecret,
    )
  )
    return apiError(400, "bad_signature", "Signature check failed.");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(400, "bad_body", "Not JSON.");
  }

  let fresh: string[];
  try {
    fresh = await recordNotices(leadNotices(body));
  } catch (e) {
    console.error(
      "meta webhook: could not record notices:",
      e instanceof Error ? e.message : String(e),
    );
    return apiError(500, "processing_failed", "Will be retried.");
  }

  // Without a token the leads wait as `received` until one is set and
  // meta:run runs.
  const deps = metaDepsFromEnv();
  let saved = 0;
  if (deps)
    for (const id of fresh) {
      try {
        if ((await processLead(id, deps)).kind === "saved") saved++;
      } catch (e) {
        // Logged by id only: a lead's answers are personal data.
        console.error(
          `meta webhook: lead ${id} not processed:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  return Response.json({ received: true, recorded: fresh.length, saved });
}
