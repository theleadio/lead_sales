"use server";

import { headers } from "next/headers";
import { requestIp } from "@/lib/help/http";
import { isHelpFormConfigured } from "@/lib/help/intake";
import { submitPageLead } from "@/lib/pages/lead";
import { COPY, type Lang } from "./copy";

// A landing page's lead form. A Server Action is a public POST endpoint:
// every check is in submitPageLead. Logs never hold what was typed.

export type LeadState = {
  done?: boolean;
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
};

const str = (v: FormDataEntryValue | null, max: number) =>
  typeof v === "string" ? v.slice(0, max) : "";

export async function submitLeadAction(
  _prev: LeadState,
  form: FormData,
): Promise<LeadState> {
  const lang: Lang = form.get("lang") === "zh" ? "zh" : "en";
  const c = COPY[lang];
  const values = {
    fullName: str(form.get("fullName"), 200),
    email: str(form.get("email"), 254),
    phone: str(form.get("phone"), 40),
  };
  const env = process.env as Record<string, string | undefined>;
  if (!isHelpFormConfigured(env)) return { error: c.closed, values };
  try {
    const h = await headers();
    const r = await submitPageLead(
      {
        slug: str(form.get("slug"), 120),
        position: Number(form.get("position")),
        ...values,
        consentMarketing: form.get("consentMarketing") === "on",
        idempotencyKey: str(form.get("idempotencyKey"), 100),
      },
      { ip: requestIp(h), env, landingUrl: h.get("referer") },
    );
    switch (r.kind) {
      case "created":
        return { done: true };
      case "invalid":
        return { error: c.check, fields: r.fields, values };
      case "rate_limited":
        return { error: c.tooMany, values };
      case "captcha_failed":
        return { error: c.captcha, values };
      case "not_found":
        return { error: c.closed, values };
    }
  } catch (e) {
    console.error(
      "page form failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { error: c.failed, values };
  }
}
