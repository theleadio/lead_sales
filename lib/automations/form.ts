import { z } from "zod";
import {
  conditionSchema,
  stepSchema,
  TRIGGERS,
  type TriggerName,
} from "./model.ts";
import type { AutomationInput } from "./admin.ts";

// What the editor posts, checked step by step so a mistake is reported where
// it is ("Step 2: ...") instead of as one failure for the whole form. The
// server action uses this and saveAutomation() checks again: a Server Action
// is a public POST endpoint, so nothing is trusted because the page sent it.

const payload = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Give it a name").max(120),
  trigger: z
    .string()
    .refine((t) => (TRIGGERS as string[]).includes(t), "Pick a trigger"),
  conditions: z.string().max(20_000),
  steps: z.string().max(100_000),
});

export type EditorResult =
  { ok: true; input: AutomationInput } | { ok: false; errors: string[] };

const messageOf = (e: z.ZodError) =>
  e.issues
    .map((i) => i.message)
    .filter((m, i, all) => all.indexOf(m) === i)
    .slice(0, 3)
    .join("; ");

function jsonArray(raw: string): unknown[] | null {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function parseEditorForm(raw: Record<string, unknown>): EditorResult {
  const head = payload.safeParse(raw);
  const errors: string[] = [];
  if (!head.success) for (const i of head.error.issues) errors.push(i.message);
  const conditionsIn = jsonArray(String(raw.conditions ?? "[]"));
  const stepsIn = jsonArray(String(raw.steps ?? "[]"));
  if (!conditionsIn || !stepsIn)
    errors.push("The form could not be read. Reload the page.");
  if (!head.success || !conditionsIn || !stepsIn) return { ok: false, errors };

  if (conditionsIn.length > 20) errors.push("Up to 20 conditions.");
  const conditions = conditionsIn.map((c, i) => {
    const r = conditionSchema.safeParse(c);
    if (!r.success) errors.push(`Condition ${i + 1}: ${messageOf(r.error)}`);
    return r.success ? r.data : null;
  });

  if (stepsIn.length === 0) errors.push("Add at least one step.");
  if (stepsIn.length > 50) errors.push("Up to 50 steps.");
  const steps = stepsIn.map((s, i) => {
    const r = stepSchema.safeParse(s);
    if (!r.success) errors.push(`Step ${i + 1}: ${messageOf(r.error)}`);
    return r.success ? r.data : null;
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      id: head.data.id || undefined,
      name: head.data.name,
      trigger: head.data.trigger as TriggerName,
      conditions: conditions.filter((c) => c !== null),
      steps: steps.filter((s) => s !== null),
    },
  };
}
