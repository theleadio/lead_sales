"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  assignConversation,
  CONVERSATION_STATUSES,
  setConversationStatus,
  ticketFromConversation,
} from "@/lib/inbox/service";
import { TicketError, type Actor } from "@/lib/tickets/service";

// Server Actions are public POST endpoints: the user comes from the session
// and every field is validated. Errors come back as fixed codes.

async function actor(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

const id = z.uuid();
const back = (c: string, error?: string) =>
  `/inbox?c=${c}${error ? `&error=${error}` : ""}`;

async function run(c: string, fn: () => Promise<unknown>): Promise<never> {
  let code: string | undefined;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    code = e.code;
  }
  redirect(back(c, code));
}

export async function assignConversationAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({ conversationId: id, userId: z.union([id, z.literal("")]) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/inbox?error=invalid");
  await run(p.data.conversationId, () =>
    assignConversation(a, p.data.conversationId, p.data.userId || null),
  );
}

export async function conversationStatusAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({ conversationId: id, status: z.enum(CONVERSATION_STATUSES) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/inbox?error=invalid");
  await run(p.data.conversationId, () =>
    setConversationStatus(a, p.data.conversationId, p.data.status),
  );
}

export async function makeTicketAction(form: FormData) {
  const a = await actor();
  const p = z
    .object({
      conversationId: id,
      category: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
      subject: z.string().trim().min(1).max(200),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/inbox?error=invalid");
  let ticketId: string | null = null;
  let code: string | undefined;
  try {
    ticketId = (
      await ticketFromConversation(a, p.data.conversationId, {
        category: p.data.category,
        subject: p.data.subject,
      })
    ).id;
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    code = e.code;
  }
  redirect(
    ticketId ? `/tickets/${ticketId}` : back(p.data.conversationId, code),
  );
}
