import { z } from "zod";
import { captureLead, type LeadResult } from "../crm/leads.ts";
import { leadSchema } from "../crm/lead-schema.ts";

// Meta Lead Ads → CRM (docs/specs/2026-11-04-meta-lead-ads-intake.md).
// Decided 4 Nov (evening): lead_sales saves the lead itself, straight into
// the shared database, with the CRM's own captureLead() rules copied into
// lib/crm/: the same dedupe, consent and deal as a website lead. No lead_crm
// endpoint (that was lead_crm PR #46, closed).
//
// The leadgen webhook and the Graph API fetch of the lead's answers, which
// call captureMetaLead(), are in lib/meta/webhook.ts.

export const metaLeadSchema = leadSchema.safeExtend({
  // `meta-leadgen:<lead id>`: Meta can deliver one lead more than once, and a
  // repeat must never make a second person or deal.
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(100)
    .regex(/^[A-Za-z0-9_.:-]+$/, "Letters, digits and _ . : - only"),
  campaignId: z.string().trim().max(100).nullish(),
  adId: z.string().trim().max(100).nullish(),
});
export type MetaLeadInput = z.output<typeof metaLeadSchema>;

// A `lead_form` touchpoint with the ad platform's ids (CRM migration 015),
// so the CRM's ads report joins it to meta_ad_insight exactly.
export async function captureMetaLead(
  input: MetaLeadInput,
): Promise<LeadResult & { replayed: boolean }> {
  const { campaignId, adId, ...lead } = input;
  return captureLead(lead, {
    landingUrl: null,
    referrer: null,
    channel: "lead_form",
    campaignId: campaignId ?? null,
    adId: adId ?? null,
  });
}
