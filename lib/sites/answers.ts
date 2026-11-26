// Answers to a form or order block's extra questions (model.ts customFieldSchema).
// The questions come from the PUBLISHED page; the visitor's answers are only
// ever checked against them, so nothing a visitor sends can add a question or
// an option.
import type { CustomField } from "./model.ts";

export type Answers =
  | { ok: true; lines: string[]; hrdc: boolean }
  | { ok: false; fields: Record<string, string> };

const MAX_TEXT = 500;
const MAX_PAX = 500;

export function checkAnswers(fields: CustomField[] | undefined, raw: unknown): Answers {
  const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lines: string[] = [];
  const bad: Record<string, string> = {};
  let hrdc = false;
  for (const f of fields ?? []) {
    const v = given[f.key];
    const options = f.options ?? [];
    let answer = "";
    if (f.kind === "multi") {
      const picked = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      if (picked.some((x) => !options.includes(x))) {
        bad[f.key] = "invalid";
        continue;
      }
      answer = options.filter((o) => picked.includes(o)).join(", ");
    } else {
      const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
      if (s) {
        if (f.kind === "choice" && !options.includes(s)) {
          bad[f.key] = "invalid";
          continue;
        }
        if (f.kind === "pax" && !(/^\d{1,3}$/.test(s) && Number(s) >= 1 && Number(s) <= MAX_PAX)) {
          bad[f.key] = "invalid";
          continue;
        }
        if ((f.kind === "text" || f.kind === "address") && s.length > MAX_TEXT) {
          bad[f.key] = "invalid";
          continue;
        }
      }
      answer = f.kind === "pax" && s ? String(Number(s)) : s;
    }
    if (!answer) {
      if (f.required) bad[f.key] = "required";
      continue;
    }
    if (f.kind === "choice" && f.hrdcOption && answer === f.hrdcOption) hrdc = true;
    lines.push(`${f.label}: ${answer.replace(/\s*\n\s*/g, ", ")}`);
  }
  return Object.keys(bad).length ? { ok: false, fields: bad } : { ok: true, lines, hrdc };
}

// The CRM message field holds 2000 characters. The visitor's own message comes
// first, then one line per answer.
export function withAnswers(message: string | undefined, lines: string[]): string | undefined {
  const all = [message?.trim() ?? "", ...lines].filter(Boolean).join("\n");
  return all ? all.slice(0, 2000) : undefined;
}
