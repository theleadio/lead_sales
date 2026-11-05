"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { saveAutomation, setAutomationActive } from "@/lib/automations/admin";
import { parseEditorForm } from "@/lib/automations/form";
import { retryRun } from "@/lib/automations/run";
import { TicketError, type Actor } from "@/lib/tickets/service";

// Server Actions are public POST endpoints: the user comes from the session,
// every field is validated here, and the library checks the role again.

async function actor(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

export type EditorState = { errors?: string[] };

export async function saveAutomationAction(
  _prev: EditorState,
  form: FormData,
): Promise<EditorState> {
  const a = await actor();
  const parsed = parseEditorForm(Object.fromEntries(form));
  if (!parsed.ok) return { errors: parsed.errors };
  let id: string;
  try {
    id = await saveAutomation(a, parsed.input);
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    return {
      errors: [
        e.code === "forbidden"
          ? "You don't have permission to change automations."
          : e.code === "not_found"
            ? "That automation no longer exists."
            : e.message,
      ],
    };
  }
  redirect(`/automations/${id}?result=saved`);
}

const uuid = z.uuid();

export async function toggleAutomationAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({
      id: uuid,
      active: z.enum(["on", "off"]),
      from: z.enum(["list", "detail"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/automations?result=invalid");
  let result = "saved";
  try {
    await setAutomationActive(a, p.data.id, p.data.active === "on");
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    result = e.code === "forbidden" ? "forbidden" : "invalid";
  }
  redirect(
    p.data.from === "list"
      ? `/automations?result=${result}`
      : `/automations/${p.data.id}?result=${result}`,
  );
}

export async function retryRunAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({ automationId: uuid, runId: uuid })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/automations?result=invalid");
  let result = "retried";
  try {
    if (!(await retryRun(a, p.data.runId))) result = "invalid";
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    result = e.code === "forbidden" ? "forbidden" : "invalid";
  }
  redirect(`/automations/${p.data.automationId}?result=${result}`);
}
