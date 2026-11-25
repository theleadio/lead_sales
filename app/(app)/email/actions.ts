"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  createDraft,
  EmailError,
  mailConfigFromEnv,
  queueCampaign,
  saveCampaign,
  sendTest,
  type Actor,
} from "@/lib/email/marketing";

// Server Actions are public POST endpoints: the user comes from the session,
// every field is validated here, and the library checks the role again.

async function actor(): Promise<Actor & { email: string | null }> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role, email: u.email };
}

const uuid = z.uuid();

const code = (e: EmailError) =>
  e.code === "forbidden"
    ? "forbidden"
    : e.code === "not_configured"
      ? "notconfigured"
      : e.code === "not_found"
        ? "gone"
        : "invalid";

export async function newCampaignAction() {
  const a = await actor();
  let id: string;
  try {
    id = await createDraft(a);
  } catch (e) {
    if (!(e instanceof EmailError)) throw e;
    redirect(`/email?result=${code(e)}`);
  }
  redirect(`/email/${id}`);
}

const saveSchema = z.object({
  id: uuid,
  name: z.string(),
  subject: z.string(),
  language: z.enum(["", "en", "zh"]),
  bodyHtml: z.string(),
});

// Saves the draft; with `then=test` or `then=send` it carries on to that step.
export async function saveCampaignAction(form: FormData) {
  const a = await actor();
  const p = saveSchema.safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/email?result=invalid");
  const tagIds = form.getAll("tagIds").map(String);
  let result = "saved";
  try {
    await saveCampaign(a, {
      id: p.data.id,
      name: p.data.name,
      subject: p.data.subject,
      language: p.data.language === "" ? null : p.data.language,
      bodyHtml: p.data.bodyHtml,
      tagIds,
    });
    const then = form.get("then");
    if (then === "test") {
      const cfg = mailConfigFromEnv();
      if (!cfg) result = "notconfigured";
      else {
        await sendTest(a, cfg, p.data.id, a.email ?? "");
        result = "tested";
      }
    }
  } catch (e) {
    if (!(e instanceof EmailError)) throw e;
    result = code(e);
  }
  redirect(`/email/${p.data.id}?result=${result}`);
}

export async function sendCampaignAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({ id: uuid, confirm: z.literal("on") })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect(`/email?result=invalid`);
  let result = "queued";
  try {
    await queueCampaign(a, p.data.id);
  } catch (e) {
    if (!(e instanceof EmailError)) throw e;
    result = code(e);
  }
  redirect(`/email/${p.data.id}?result=${result}`);
}
