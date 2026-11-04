"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findPersonByContact } from "@/lib/tickets/read";
import {
  addNote,
  assignTicket,
  changeCategory,
  createTicket,
  PRIORITIES,
  setStatus,
  STATUSES,
  TicketError,
  type Actor,
} from "@/lib/tickets/service";

// Server Actions are public POST endpoints: the user comes from the session,
// never the form, and every field is validated here. A refusal or bad input
// comes back as ?error=<code>, which the page turns into a fixed message
// (never echoing request text).

async function actor(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

const id = z.uuid();

function errorCode(e: unknown): string {
  if (e instanceof TicketError)
    return e.code === "invalid" ? "invalid" : e.code;
  throw e;
}

async function onTicket(ticketId: string, run: () => Promise<void>) {
  let code: string | null = null;
  try {
    await run();
  } catch (e) {
    code = errorCode(e);
  }
  redirect(`/tickets/${ticketId}${code ? `?error=${code}` : ""}`);
}

export async function setStatusAction(formData: FormData) {
  const a = await actor();
  const p = z
    .object({ ticketId: id, status: z.enum(STATUSES) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) redirect("/tickets?error=invalid");
  await onTicket(p.data.ticketId, () =>
    setStatus(p.data.ticketId, p.data.status, a),
  );
}

export async function assignAction(formData: FormData) {
  const a = await actor();
  const p = z
    .object({ ticketId: id, userId: z.union([id, z.literal("")]) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) redirect("/tickets?error=invalid");
  await onTicket(p.data.ticketId, () =>
    assignTicket(p.data.ticketId, p.data.userId || null, a),
  );
}

export async function categoryAction(formData: FormData) {
  const a = await actor();
  const p = z
    .object({
      ticketId: id,
      category: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
    })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) redirect("/tickets?error=invalid");
  await onTicket(p.data.ticketId, () =>
    changeCategory(p.data.ticketId, p.data.category, a),
  );
}

export async function noteAction(formData: FormData) {
  const a = await actor();
  const p = z
    .object({ ticketId: id, note: z.string().trim().min(1).max(5000) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) redirect("/tickets?error=invalid");
  await onTicket(p.data.ticketId, () =>
    addNote(p.data.ticketId, p.data.note, a),
  );
}

const newSchema = z.object({
  contact: z.string().trim().min(3).max(254),
  category: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  subject: z.string().trim().min(1).max(200),
  priority: z.enum(PRIORITIES),
  note: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null),
});

export async function createTicketAction(formData: FormData) {
  const a = await actor();
  const p = newSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) redirect("/tickets/new?error=invalid");
  const people = await findPersonByContact(p.data.contact);
  if (people.length === 0) redirect("/tickets/new?error=no_person");
  if (people.length > 1) redirect("/tickets/new?error=many_people");
  let ticketId: string;
  try {
    ticketId = (
      await createTicket(
        {
          personId: people[0].id,
          sourceChannel: "manual",
          category: p.data.category,
          subject: p.data.subject,
          priority: p.data.priority,
          note: p.data.note,
        },
        a,
      )
    ).id;
  } catch (e) {
    redirect(`/tickets/new?error=${errorCode(e)}`);
  }
  redirect(`/tickets/${ticketId}`);
}
