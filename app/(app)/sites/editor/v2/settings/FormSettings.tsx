"use client";

// LEAD form and order form settings. The draft is validated against the real
// schemas on every change: invalid settings show inline errors and are never
// committed. Labels are the old editor's.
import { isRealDate, workshopFormName } from "@/lib/sites/workshop-name";
import { leadFormSettingsSchema, orderFormSettingsSchema, type LeadFormSettings, type OrderFormSettings } from "@/lib/sites/model";
import type { ClassOpt, StepInfo } from "../types";
import { ErrText, Group, InputField, SelectField, Toggle, useDraft } from "./controls";

const FIELDS: ("company" | "jobTitle" | "message")[] = ["company", "jobTitle", "message"];
const FIELD_LABEL = { company: "Ask for company", jobTitle: "Ask for job title", message: "Ask for a message" };

const MSG: Record<string, string> = {
  workshop: "Fill in the workshop details",
  "workshop.title": "Enter the workshop title",
  "workshop.date": "Enter a real date",
  "after.url": "Use an address starting with https://",
};
function errors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.join(".");
    out[k] ??= MSG[k] ?? i.message;
  }
  return out;
}
const opt = (v: string) => (v === "" ? undefined : v);

export function LeadFormBlock({ settings, steps, onCommit }: { settings: LeadFormSettings; steps: StepInfo[]; onCommit: (s: LeadFormSettings) => void }) {
  const { draft, set, focus } = useDraft(settings, (s) => {
    if (leadFormSettingsSchema.safeParse(s).success) onCommit(s);
  });
  const res = leadFormSettingsSchema.safeParse(draft);
  const errs = res.success ? {} : errors(res.error.issues);
  const up = (patch: Partial<LeadFormSettings>, now = false) => set({ ...draft, ...patch }, now);
  const w = draft.workshop;
  const upW = (patch: Partial<NonNullable<LeadFormSettings["workshop"]>>) =>
    up({ workshop: { title: "", date: "", language: "en", ...w, ...patch } });
  const preview = draft.type === "workshop" && w && w.title.trim() && isRealDate(w.date) ? workshopFormName(w.title, w.date) : null;
  const after = draft.after;
  return (
    <Group title="LEAD form">
      <SelectField
        label="Form type"
        value={draft.type}
        options={[["workshop", "Workshop sign-up"], ["interest", "Interest"], ["enquiry", "Enquiry"]]}
        onPick={(type) => up({ type, workshop: type === "workshop" ? (w ?? { title: "", date: "", language: "en" }) : undefined }, true)}
      />
      {draft.type === "workshop" && (
        <>
          <InputField label="Workshop title" value={w?.title ?? ""} onChange={(title) => upW({ title })} error={errs["workshop.title"] ?? errs.workshop} {...focus} />
          <InputField label="Workshop date" type="date" value={w?.date ?? ""} onChange={(date) => upW({ date })} error={errs["workshop.date"]} {...focus} />
          <SelectField label="Workshop language" value={w?.language ?? "en"} options={[["en", "English"], ["zh", "Chinese"]]} onPick={(language) => upW({ language })} />
          {preview && (
            <p className="note">
              Counts on Home → Free workshops as <code className="k">{preview}</code>
            </p>
          )}
        </>
      )}
      <InputField label="Form name (optional)" value={draft.formName ?? ""} onChange={(v) => up({ formName: opt(v) })} {...focus} />
      <InputField label="Course code (optional)" value={draft.courseCode ?? ""} onChange={(v) => up({ courseCode: opt(v) })} {...focus} />
      <InputField label="Class code (optional)" value={draft.classCode ?? ""} onChange={(v) => up({ classCode: opt(v) })} {...focus} />
      <p className="note">Name, email, phone and the marketing-consent box are always included.</p>
      {FIELDS.map((k) => (
        <Toggle
          key={k}
          label={FIELD_LABEL[k]}
          on={draft.fields.includes(k)}
          onChange={(on) => up({ fields: FIELDS.filter((f) => (f === k ? on : draft.fields.includes(f))) }, true)}
        />
      ))}
      <Toggle label="Create a deal" on={draft.createDeal} onChange={(createDeal) => up({ createDeal }, true)} />
      <SelectField
        label="After submit"
        value={after.kind}
        options={[["message", "Show a message"], ["step", "Go to a step"], ["url", "Go to a website"]]}
        onPick={(kind) =>
          up({ after: kind === "message" ? { kind, text: "[Thank-you message]" } : kind === "step" ? { kind, pageId: steps[0]?.id ?? "" } : { kind, url: "" } }, true)
        }
      />
      {after.kind === "message" && <InputField label="Message" value={after.text} onChange={(text) => up({ after: { kind: "message", text } })} {...focus} />}
      {after.kind === "step" && (
        <SelectField label="Step" value={after.pageId} options={steps.length ? steps.map((s) => [s.id, s.name]) : [["", "No steps"]]} onPick={(pageId) => up({ after: { kind: "step", pageId } }, true)} />
      )}
      {after.kind === "url" && <InputField label="Website (https)" value={after.url} onChange={(url) => up({ after: { kind: "url", url } })} error={errs["after.url"]} {...focus} />}
      {!res.success && <ErrText msg={"Not saved yet: " + Object.values(errs).join(" · ")} />}
    </Group>
  );
}

export function OrderFormBlock({ settings, classes, onCommit }: { classes: ClassOpt[]; settings: OrderFormSettings; onCommit: (s: OrderFormSettings) => void }) {
  const { draft, set, focus } = useDraft(settings, (s) => {
    if (orderFormSettingsSchema.safeParse(s).success) onCommit(s);
  });
  const res = orderFormSettingsSchema.safeParse(draft);
  return (
    <Group title="Order form">
      {classes.length > 0 ? (
        <SelectField
          label="Class"
          value={draft.classCode}
          options={[
            ...(draft.classCode && !classes.some((c) => c.code === draft.classCode) ? [[draft.classCode, draft.classCode] as [string, string]] : []),
            ["", "Choose a class"],
            ...classes.map((c) => [c.code, `${c.courseName} (${c.code}) ${c.startDate}`] as [string, string]),
          ]}
          onPick={(classCode) => set({ ...draft, classCode }, true)}
        />
      ) : (
        <InputField label="Class code (the class list could not be loaded)" value={draft.classCode} onChange={(classCode) => set({ ...draft, classCode })} {...focus} />
      )}
      <p className="note">Payment goes through the CRM&apos;s Stripe checkout.</p>
      <Toggle label="Ask for company" on={draft.askCompany} onChange={(askCompany) => set({ ...draft, askCompany }, true)} />
      {!res.success && <ErrText msg="Not saved yet: check the settings above." />}
    </Group>
  );
}
