import {
  leadFormSettingsSchema,
  orderFormSettingsSchema,
  type LeadFormSettings,
  type OrderFormSettings,
} from "../../../../../lib/sites/model.ts";
import type { Attrs } from "./types.ts";

// Pure conversions between trait values ("props") and what a component
// carries in its attributes. Every write is validated with the same schema
// the publish check uses, so an invalid setting never reaches the draft.

type Props = Record<string, unknown>;
type Out = { attrs?: Attrs; text?: string; error?: string };
const str = (p: Props, k: string) => String(p[k] ?? "").trim();
const bool = (p: Props, k: string) => p[k] === true || p[k] === "true";

export const FORM_DEFAULT: LeadFormSettings = {
  type: "interest",
  fields: [],
  createDeal: false,
  after: { kind: "message", text: "Thanks, we will be in touch." },
};

export function parseJson(raw: string | undefined): unknown {
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function formProps(raw: string | undefined): Props {
  const r = leadFormSettingsSchema.safeParse(parseJson(raw));
  const s = r.success ? r.data : FORM_DEFAULT;
  return {
    s_type: s.type,
    s_wTitle: s.workshop?.title ?? "",
    s_wDate: s.workshop?.date ?? "",
    s_wLang: s.workshop?.language ?? "en",
    s_formName: s.formName ?? "",
    s_courseCode: s.courseCode ?? "",
    s_classCode: s.classCode ?? "",
    s_company: s.fields.includes("company"),
    s_jobTitle: s.fields.includes("jobTitle"),
    s_message: s.fields.includes("message"),
    s_deal: s.createDeal,
    s_afterKind: s.after.kind,
    s_afterText: s.after.kind === "message" ? s.after.text : "",
    s_afterStep: s.after.kind === "step" ? s.after.pageId : "",
    s_afterUrl: s.after.kind === "url" ? s.after.url : "",
  };
}

export function formWrite(p: Props): Out {
  const type = str(p, "s_type");
  const kind = str(p, "s_afterKind");
  const opt = (k: string) => str(p, k) || undefined;
  if (kind === "step" && !str(p, "s_afterStep")) return { error: "Pick the step to go to after submit." };
  const r = leadFormSettingsSchema.safeParse({
    type,
    workshop:
      type === "workshop"
        ? { title: str(p, "s_wTitle"), date: str(p, "s_wDate"), language: str(p, "s_wLang") || "en" }
        : undefined,
    formName: opt("s_formName"),
    courseCode: opt("s_courseCode"),
    classCode: opt("s_classCode"),
    fields: (["company", "jobTitle", "message"] as const).filter((f) => bool(p, `s_${f}`)),
    createDeal: bool(p, "s_deal"),
    after:
      kind === "step"
        ? { kind, pageId: str(p, "s_afterStep") }
        : kind === "url"
          ? { kind, url: str(p, "s_afterUrl") }
          : { kind: "message", text: str(p, "s_afterText") },
  });
  if (!r.success) {
    const i = r.error.issues[0];
    return { error: `Form not updated: ${i.path.join(".") || "settings"} ${i.message}` };
  }
  return { attrs: { "data-settings": JSON.stringify(r.data) } };
}

export function orderProps(raw: string | undefined): Props {
  const r = orderFormSettingsSchema.safeParse(parseJson(raw));
  const s: OrderFormSettings = r.success ? r.data : { classCode: "", askCompany: false };
  return { s_classCode: s.classCode, s_askCompany: s.askCompany };
}

export function orderWrite(p: Props): Out {
  const r = orderFormSettingsSchema.safeParse({ classCode: str(p, "s_classCode"), askCompany: bool(p, "s_askCompany") });
  return r.success ? { attrs: { "data-settings": JSON.stringify(r.data) } } : { error: "Order form not updated." };
}

// ---- links ----

// A button goes to: an https URL, a step of this funnel (by path), or #form.
export function resolveHref(link: string, url: string): string | null {
  if (link === "form") return "#form";
  if (link.startsWith("step:")) return link.slice(5);
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function linkProps(href: string | undefined): Props {
  const h = href ?? "";
  if (h === "#form" || h === "") return { s_link: "form", s_url: "" };
  if (h.startsWith("/")) return { s_link: `step:${h}`, s_url: "" };
  return { s_link: "url", s_url: h };
}

export function linkWrite(p: Props): Out {
  const href = resolveHref(str(p, "s_link"), str(p, "s_url"));
  return href === null ? { error: "Use a full https:// link." } : { attrs: { href } };
}

export const waDigits = (v: string) => v.replace(/\D/g, "");
export function waWrite(p: Props): Out {
  const d = waDigits(str(p, "s_phone"));
  return /^\d{8,15}$/.test(d)
    ? { attrs: { href: `https://wa.me/${d}` } }
    : { error: "WhatsApp number: 8 to 15 digits, with country code." };
}
export const waProps = (href: string | undefined): Props => ({ s_phone: /wa\.me\/(\d+)/.exec(href ?? "")?.[1] ?? "" });

export function counterWrite(p: Props): Out {
  const to = Number(str(p, "s_to"));
  return Number.isFinite(to) && to >= 0
    ? { attrs: { "data-settings": JSON.stringify({ to }) }, text: String(to) }
    : { error: "The counter needs a number." };
}
export const counterProps = (raw: string | undefined): Props => ({
  s_to: Number((parseJson(raw) as { to?: unknown } | undefined)?.to ?? 100),
});
