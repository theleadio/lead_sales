"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { savePage, setPagePublished } from "@/lib/pages/admin";
import { TicketError, type Actor } from "@/lib/tickets/service";

// Server Actions are public POST endpoints: the user comes from the session,
// and lib/pages/admin.ts checks the role and every field.

async function actor(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

export type EditorState = { error?: string };

export async function savePageAction(
  _prev: EditorState,
  form: FormData,
): Promise<EditorState> {
  const a = await actor();
  let blocks: unknown;
  try {
    blocks = JSON.parse(String(form.get("blocks") ?? "[]"));
  } catch {
    return { error: "Reload the page and try again." };
  }
  const id = form.get("id");
  let saved: string;
  try {
    saved = await savePage(
      a,
      {
        title: form.get("title"),
        slug: form.get("slug"),
        description: form.get("description"),
        language: form.get("language"),
        blocks,
      },
      typeof id === "string" && id ? id : undefined,
    );
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    return { error: e.message };
  }
  redirect(`/sites/${saved}?result=saved`);
}

export async function publishPageAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({ id: z.uuid(), published: z.enum(["on", "off"]) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/sites");
  let result = p.data.published === "on" ? "published" : "unpublished";
  try {
    await setPagePublished(a, p.data.id, p.data.published === "on");
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    result = "forbidden";
  }
  redirect(`/sites/${p.data.id}?result=${result}`);
}
