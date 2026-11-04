"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { CHANNELS, TicketError, type Actor } from "@/lib/tickets/service";
import {
  addHolidays,
  addRule,
  addTeamMember,
  deleteHoliday,
  deleteRule,
  removeTeamMember,
  saveCategory,
} from "@/lib/tickets/settings";

// Server Actions are public POST endpoints: the user comes from the
// session, every field is validated, and the library checks the role
// again. Results come back as fixed codes in the URL.

const PAGE = "/settings/tickets";

async function actor(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) redirect("/sign-in");
  return { id: u.id, role: u.role };
}

async function run(fn: () => Promise<unknown>, ok = "saved"): Promise<never> {
  let code = ok;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    code = e.code === "forbidden" ? "forbidden" : "invalid";
  }
  redirect(`${PAGE}?result=${code}`);
}

const parse = <T extends z.ZodType>(schema: T, form: FormData): z.output<T> => {
  const p = schema.safeParse(Object.fromEntries(form));
  if (!p.success) redirect(`${PAGE}?result=invalid`);
  return p.data;
};

const uuid = z.uuid();
const email = z.string().trim().min(3).max(320);
const optional = z
  .string()
  .trim()
  .max(100)
  .transform((v) => v || null);

export async function addMemberAction(form: FormData) {
  const a = await actor();
  const d = parse(z.object({ teamId: uuid, email }), form);
  await run(() => addTeamMember(a, d.teamId, d.email));
}

export async function removeMemberAction(form: FormData) {
  const a = await actor();
  const d = parse(z.object({ teamId: uuid, userId: uuid }), form);
  await run(() => removeTeamMember(a, d.teamId, d.userId));
}

export async function saveCategoryAction(form: FormData) {
  const a = await actor();
  const d = parse(
    z.object({
      code: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{1,30}$/),
      labelEn: z.string().trim().min(1).max(100),
      labelZh: optional,
      teamId: uuid,
      keywords: z.string().max(2000).default(""),
      position: z.coerce.number().int().min(0).max(10000).default(100),
      active: z.literal("on").optional(),
    }),
    form,
  );
  await run(() =>
    saveCategory(a, {
      ...d,
      keywords: d.keywords.split(","),
      active: d.active === "on",
    }),
  );
}

export async function addRuleAction(form: FormData) {
  const a = await actor();
  const d = parse(
    z.object({
      position: z.coerce.number().int().min(0).max(10000),
      matchChannel: z.union([z.enum(CHANNELS), z.literal("")]),
      matchCategory: z.union([
        z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
        z.literal(""),
      ]),
      setTeamId: z.union([uuid, z.literal("")]),
      assignMode: z.enum(["round_robin", "fixed", "none"]),
      assignEmail: z.string().trim().max(320).default(""),
    }),
    form,
  );
  await run(() =>
    addRule(a, {
      position: d.position,
      matchChannel: d.matchChannel || null,
      matchCategory: d.matchCategory || null,
      setTeamId: d.setTeamId || null,
      assignMode: d.assignMode,
      assignEmail: d.assignEmail || null,
    }),
  );
}

export async function deleteRuleAction(form: FormData) {
  const a = await actor();
  const d = parse(z.object({ ruleId: uuid }), form);
  await run(() => deleteRule(a, d.ruleId));
}

export async function addHolidaysAction(form: FormData) {
  const a = await actor();
  const d = parse(z.object({ lines: z.string().min(1).max(10000) }), form);
  let code = "saved";
  try {
    const r = await addHolidays(a, d.lines);
    if (r.bad.length) code = "bad_holidays";
  } catch (e) {
    if (!(e instanceof TicketError)) throw e;
    code = e.code === "forbidden" ? "forbidden" : "invalid";
  }
  redirect(`${PAGE}?result=${code}`);
}

export async function deleteHolidayAction(form: FormData) {
  const a = await actor();
  const d = parse(
    z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    form,
  );
  await run(() => deleteHoliday(a, d.day));
}
