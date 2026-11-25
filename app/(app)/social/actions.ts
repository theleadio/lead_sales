"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDay, parseMyt, dayStart } from "@/lib/social/planner";
import {
  createPost,
  deletePost,
  getPost,
  markPosted,
  removeMedia,
  retryChannel,
  savePost,
  SocialError,
  type Actor,
} from "@/lib/social/social";

// Server Actions are public POST endpoints: the user comes from the session,
// every field is validated here, and the library checks the role again.

async function actor(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

const uuid = z.uuid();

const code = (e: SocialError) =>
  e.code === "forbidden"
    ? "forbidden"
    : e.code === "not_found"
      ? "gone"
      : e.code === "locked"
        ? "locked"
        : "invalid";

// Which rule refused it, as a key (lib/social/planner.ts REASONS): the page
// shows that rule's sentence.
const detail = (e: SocialError) => (e.reason ? `&why=${e.reason}` : "");

// A new draft. From a calendar day it starts at 10:00 that day.
export async function newPostAction(form: FormData) {
  const a = await actor();
  const day = String(form.get("day") ?? "");
  const at = isDay(day)
    ? new Date(dayStart(day).getTime() + 10 * 60 * 60 * 1000)
    : null;
  let id: string;
  try {
    id = await createPost(a, at && at > new Date() ? at : null);
  } catch (e) {
    if (!(e instanceof SocialError)) throw e;
    redirect(`/social?result=${code(e)}`);
  }
  redirect(`/social/${id}`);
}

const saveSchema = z.object({
  id: uuid,
  body: z.string().max(20000),
  link: z.string().max(2000),
  when: z.string().max(40),
  intent: z.enum(["draft", "schedule"]),
});

export async function savePostAction(form: FormData) {
  const a = await actor();
  const p = saveSchema.safeParse({
    id: form.get("id"),
    body: form.get("body") ?? "",
    link: form.get("link") ?? "",
    when: form.get("when") ?? "",
    intent: form.get("intent"),
  });
  if (!p.success) redirect("/social?result=invalid");
  const when = p.data.when.trim();
  const scheduledAt = when ? parseMyt(when) : null;
  let result = p.data.intent === "schedule" ? "scheduled" : "saved";
  let why = "";
  try {
    if (when && !scheduledAt)
      throw new SocialError("invalid", "bad_time");
    const input = {
      id: p.data.id,
      body: p.data.body,
      link: p.data.link,
      mediaIds: form.getAll("mediaIds").map(String),
      channels: form.getAll("channels").map(String),
      scheduledAt,
      intent: p.data.intent,
    };
    try {
      await savePost(a, input);
    } catch (e) {
      // A draft that can't be scheduled yet keeps what was typed: it is
      // saved as a draft, and the note says what still stops scheduling.
      // (A post that is already scheduled stays as it was.)
      if (
        e instanceof SocialError &&
        e.code === "invalid" &&
        input.intent === "schedule" &&
        (await getPost(input.id))?.status === "draft"
      )
        await savePost(a, { ...input, intent: "draft" }).catch(() => {});
      throw e;
    }
  } catch (e) {
    if (!(e instanceof SocialError)) throw e;
    result = code(e);
    why = detail(e);
  }
  redirect(`/social/${p.data.id}?result=${result}${why}`);
}

export async function deletePostAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({ id: uuid, confirm: z.literal("on") })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/social?result=invalid");
  try {
    await deletePost(a, p.data.id);
  } catch (e) {
    if (!(e instanceof SocialError)) throw e;
    redirect(`/social/${p.data.id}?result=${code(e)}`);
  }
  redirect("/social?result=deleted");
}

const channelSchema = z.object({
  id: uuid,
  channel: z.string().max(20),
  url: z.string().max(2000).optional(),
  back: z.enum(["post", "planner"]).optional(),
});

const backTo = (id: string, back: string | undefined, result: string) =>
  back === "planner" ? `/social?result=${result}` : `/social/${id}?result=${result}`;

export async function markPostedAction(form: FormData) {
  const a = await actor();
  const p = channelSchema.safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/social?result=invalid");
  let result = "marked";
  let why = "";
  try {
    await markPosted(a, p.data.id, p.data.channel, p.data.url ?? "");
  } catch (e) {
    if (!(e instanceof SocialError)) throw e;
    result = code(e);
    why = detail(e);
  }
  redirect(backTo(p.data.id, p.data.back, result) + why);
}

export async function retryAction(form: FormData) {
  const a = await actor();
  const p = channelSchema.safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/social?result=invalid");
  let result = "retrying";
  let why = "";
  try {
    await retryChannel(a, p.data.id, p.data.channel);
  } catch (e) {
    if (!(e instanceof SocialError)) throw e;
    result = code(e);
    why = detail(e);
  }
  redirect(backTo(p.data.id, p.data.back, result) + why);
}

export async function removeMediaAction(form: FormData) {
  const a = await actor();
  const p = z.object({ id: uuid }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/social/library?result=invalid");
  let result = "removed";
  try {
    await removeMedia(a, p.data.id);
  } catch (e) {
    if (!(e instanceof SocialError)) throw e;
    result = code(e);
  }
  redirect(`/social/library?result=${result}`);
}
