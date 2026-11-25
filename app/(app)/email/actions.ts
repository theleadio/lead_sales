"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { blocksSchema } from "@/lib/email/blocks";
import { parseMyt } from "@/lib/social/planner";
import {
  createDraft,
  duplicateCampaign,
  EmailError,
  mailConfigFromEnv,
  queueCampaign,
  saveCampaign,
  scheduleCampaign,
  sendTest,
  unscheduleCampaign,
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
  bodyHtml: z.string().default(""),
  // "blocks": the editor's blocks, as JSON, make the email.
  mode: z.enum(["blocks", "html"]).default("html"),
  blocks: z.string().default(""),
});

// Saves the draft; with `then=test` or `then=send` it carries on to that step.
export async function saveCampaignAction(form: FormData) {
  const a = await actor();
  const p = saveSchema.safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/email?result=invalid");
  const tagIds = form.getAll("tagIds").map(String);
  let blocks = null;
  if (p.data.mode === "blocks") {
    let raw: unknown;
    try {
      raw = JSON.parse(p.data.blocks);
    } catch {
      redirect(`/email/${p.data.id}?result=invalid`);
    }
    const b = blocksSchema.safeParse(raw);
    if (!b.success) redirect(`/email/${p.data.id}?result=badblock`);
    blocks = b.data;
  }
  let result = "saved";
  try {
    await saveCampaign(a, {
      id: p.data.id,
      name: p.data.name,
      subject: p.data.subject,
      language: p.data.language === "" ? null : p.data.language,
      bodyHtml: p.data.bodyHtml,
      blocks,
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

// Sends now, or with `when=later` schedules it for `at` (Malaysia time).
export async function sendCampaignAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({
      id: uuid,
      confirm: z.literal("on"),
      when: z.enum(["now", "later"]).default("now"),
      at: z.string().default(""),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect(`/email?result=invalid`);
  let result = "queued";
  try {
    if (p.data.when === "later") {
      const at = parseMyt(p.data.at);
      if (!at) result = "badtime";
      else {
        await scheduleCampaign(a, p.data.id, at);
        result = "scheduled";
      }
    } else await queueCampaign(a, p.data.id);
  } catch (e) {
    if (!(e instanceof EmailError)) throw e;
    result =
      e.code === "invalid" && /minutes|year/.test(e.message)
        ? "badtime"
        : code(e);
  }
  redirect(`/email/${p.data.id}?result=${result}`);
}

export async function unscheduleAction(form: FormData) {
  const a = await actor();
  const p = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect(`/email?result=invalid`);
  let result = "unscheduled";
  try {
    await unscheduleCampaign(a, p.data.id);
  } catch (e) {
    if (!(e instanceof EmailError)) throw e;
    result = code(e);
  }
  redirect(`/email/${p.data.id}?result=${result}`);
}

export async function duplicateAction(form: FormData) {
  const a = await actor();
  const p = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect(`/email?result=invalid`);
  let id: string;
  try {
    id = await duplicateCampaign(a, p.data.id);
  } catch (e) {
    if (!(e instanceof EmailError)) throw e;
    redirect(`/email?result=${code(e)}`);
  }
  redirect(`/email/${id}?result=duplicated`);
}
