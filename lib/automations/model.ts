import { z } from "zod";

// What an automation is made of (automations spec §3), and the pure rules
// for checking it. No database here, so it is tested on its own.

// ---- Triggers -------------------------------------------------------------------

// CRM events lead_sales reads (never consumes) from the CRM's event_outbox,
// each with how to find the one person a run is for. Class-wide events fan
// out to the enrolled students where the payload lists them.
export const CRM_TRIGGERS = {
  LeadCaptured: "person",
  DealStageChanged: "deal",
  EnrolmentCreated: "enrolment",
  EnrolmentConfirmed: "enrolment",
  EnrolmentCancelled: "enrolment",
  EnrolmentTransferred: "enrolment",
  PaymentRecorded: "payment",
  ConsentChanged: "person",
  EnquiryConverted: "deal_in_payload",
  ClassCancelled: "enrolments_in_payload",
} as const;

// Read from tables (not the outbox):
//   EnquiryCreated    a new CRM enquiry (lead_crm `enquiry`, which holds the
//                     former tickets since its migration 019)
//   MessageReceived   a customer message (lead_crm `conversation_message`,
//                     direction in)
//   LmsAccountReady   the LMS accepted enrolment.confirmed (lms_notice
//                     sent_at): the account and temp-password email exist,
//                     so onboarding can start (spec §5.1)
export const SALES_TRIGGERS = [
  "EnquiryCreated",
  "MessageReceived",
  "LmsAccountReady",
] as const;

export type TriggerName =
  keyof typeof CRM_TRIGGERS | (typeof SALES_TRIGGERS)[number];
export const TRIGGERS = [
  ...Object.keys(CRM_TRIGGERS),
  ...SALES_TRIGGERS,
] as TriggerName[];

export const TRIGGER_LABEL: Record<TriggerName, string> = {
  LeadCaptured: "New lead",
  DealStageChanged: "Deal moved stage",
  EnrolmentCreated: "Enrolment created",
  EnrolmentConfirmed: "Enrolment confirmed",
  EnrolmentCancelled: "Enrolment cancelled",
  EnrolmentTransferred: "Enrolment transferred",
  PaymentRecorded: "Payment recorded",
  ConsentChanged: "Consent changed",
  EnquiryConverted: "Enquiry became a deal",
  ClassCancelled: "Class cancelled (each student)",
  EnquiryCreated: "Enquiry created",
  MessageReceived: "Customer message received",
  LmsAccountReady: "LMS account ready (onboarding)",
};

// ---- Conditions -----------------------------------------------------------------

export const conditionSchema = z.union([
  z.object({
    field: z.literal("person.preferred_language"),
    op: z.enum(["eq", "neq"]),
    value: z.enum(["en", "zh"]),
  }),
  z.object({
    field: z.literal("person.tag"),
    op: z.enum(["has", "lacks"]),
    value: z.string().trim().min(1).max(60),
  }),
  z.object({
    field: z.enum(["person.email", "person.phone"]),
    op: z.enum(["present", "missing"]),
  }),
  // A top-level field of the trigger's payload, e.g. DealStageChanged's
  // toStage, EnquiryCreated's category, MessageReceived's channel.
  z.object({
    field: z.string().regex(/^event\.[A-Za-z][A-Za-z0-9_]{0,40}$/),
    op: z.enum(["eq", "neq"]),
    value: z.string().max(200),
  }),
]);
export type Condition = z.infer<typeof conditionSchema>;
export const conditionsSchema = z.array(conditionSchema).max(20);

export type Facts = {
  preferredLanguage: string | null;
  tags: string[]; // lowercased
  email: string | null;
  phone: string | null;
  event: Record<string, unknown>;
};

// All conditions must hold (AND). An empty list always holds.
export function conditionsHold(conds: Condition[], f: Facts): boolean {
  return conds.every((c) => {
    if (c.field === "person.preferred_language") {
      const same = (f.preferredLanguage ?? "en") === c.value;
      return c.op === "eq" ? same : !same;
    }
    if (c.field === "person.tag") {
      const has = f.tags.includes(c.value.toLowerCase());
      return c.op === "has" ? has : !has;
    }
    if (c.field === "person.email" || c.field === "person.phone") {
      const v = c.field === "person.email" ? f.email : f.phone;
      return c.op === "present" ? Boolean(v) : !v;
    }
    if (c.field.startsWith("event.") && "value" in c) {
      const raw = f.event[c.field.slice("event.".length)];
      const same = raw !== undefined && raw !== null && String(raw) === c.value;
      return c.op === "eq" ? same : !same;
    }
    return false;
  });
}

// ---- Steps ----------------------------------------------------------------------

const tag = z.string().trim().min(1).max(60);

const sendSettings = z.object({
  template: z.string().trim().min(1).max(100),
  // service: course messages to students (onboarding, reminders), sent
  // without marketing consent (decided 4 Nov). marketing: needs it.
  purpose: z.enum(["service", "marketing"]),
});

export const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_tag"), settings: z.object({ tag }) }),
  z.object({ kind: z.literal("remove_tag"), settings: z.object({ tag }) }),
  z.object({
    kind: z.literal("create_task"),
    settings: z.object({
      title: z.string().trim().min(1).max(200),
      type: z.enum(["follow_up", "call", "other"]).default("follow_up"),
      // Due the next working day (inbox deadline rules), or in N hours.
      due: z
        .union([
          z.object({ nextWorkingDay: z.literal(true) }),
          z.object({
            hours: z
              .number()
              .int()
              .min(0)
              .max(24 * 60),
          }),
        ])
        .default({ nextWorkingDay: true }),
      // The deal's owner when the trigger has a deal, else the duty
      // super_admin.
      assignTo: z
        .enum(["deal_owner", "duty_super_admin"])
        .default("deal_owner"),
    }),
  }),
  z.object({
    kind: z.literal("wait"),
    settings: z
      .object({
        hours: z
          .number()
          .int()
          .min(0)
          .max(24 * 60)
          .default(0),
        days: z.number().int().min(0).max(60).default(0),
      })
      .refine((w) => w.hours + w.days > 0, "Wait at least an hour"),
  }),
  z.object({ kind: z.literal("stop_if_replied"), settings: z.object({}) }),
  z.object({ kind: z.literal("send_email"), settings: sendSettings }),
  z.object({ kind: z.literal("send_whatsapp"), settings: sendSettings }),
]);
export type Step = z.infer<typeof stepSchema>;
export const stepsSchema = z.array(stepSchema).min(1).max(50);

export const WAIT_MS = (w: { hours: number; days: number }) =>
  (w.days * 24 + w.hours) * 3600_000;

// Retries for a step that failed for a passing reason (the same schedule as
// the LMS sender), then the run fails.
export const MAX_ATTEMPTS = 5;
export const BACKOFF_SECONDS = [60, 300, 1800, 7200];
