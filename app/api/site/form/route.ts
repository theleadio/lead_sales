import type { NextRequest } from "next/server";
import { readCapped, submitForm } from "@/lib/sites/forms";
import { isPublicHost } from "@/lib/sites/host";
import { clientIp, fromPublicOrigin } from "@/lib/sites/stats";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

// A LEAD form submission from the public runtime. POST JSON; the form's
// settings are read from the published page, not from the body.
export async function POST(req: NextRequest) {
  if (!isPublicHost(req.headers.get("host") ?? "")) return new Response("Not found", { status: 404 });
  if (!fromPublicOrigin(req.headers.get("origin"), req.headers.get("referer"))) return new Response("Forbidden", { status: 403 });
  let b: Record<string, unknown> = {};
  try {
    const text = await readCapped(req, 16 * 1024);
    if (text === null) return new Response("Payload too large", { status: 413 });
    const j = JSON.parse(text);
    if (j && typeof j === "object") b = j;
  } catch {}
  if (typeof b.pageId !== "string" || typeof b.formId !== "string" || typeof b.idempotencyKey !== "string") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const r = await submitForm(
    {
      pageId: b.pageId,
      formId: b.formId,
      fullName: str(b.fullName, 200) ?? "",
      email: str(b.email, 320) ?? "",
      phone: str(b.phone, 50) ?? "",
      companyName: str(b.companyName, 200),
      jobTitle: str(b.jobTitle, 200),
      message: str(b.message, 5000),
      consentMarketing: b.consentMarketing === true,
      idempotencyKey: b.idempotencyKey.slice(0, 100),
      captchaToken: str(b.captchaToken, 4000),
      firstTouch: req.cookies.get("lead_first_touch")?.value,
      lastTouch: req.cookies.get("lead_last_touch")?.value,
      landingUrl: str(b.landingUrl, 2000) ?? "",
      referrer: str(b.referrer, 2000) ?? null,
      fbp: req.cookies.get("_fbp")?.value,
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
    { clientIp: clientIp(req.headers) },
  );
  switch (r.kind) {
    case "ok":
      return Response.json({ after: r.after });
    case "invalid":
      return Response.json({ error: "invalid", fields: r.fields }, { status: 400 });
    case "captcha":
      return Response.json({ error: "captcha" }, { status: 400 });
    case "limited":
      return Response.json({ error: "limited" }, { status: 429 });
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    default:
      return Response.json({ error: "unavailable", whatsapp: r.whatsapp }, { status: 502 });
  }
}
