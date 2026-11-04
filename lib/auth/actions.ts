"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "./server";
import { safeNext, WRONG_LOGIN } from "./sign-in";

// Server Actions are public POST endpoints, so input is validated here.
//
// Not yet here, unlike lead_crm: the sign-in audit trail and the 5-failures
// lockout. lead_crm keeps both in its audit_log table, which lead_sales must
// not write directly (README ground rules). Decide before go-live: a
// `sales.audit_log`, or an internal CRM endpoint.
const signInSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1000),
  next: z.string().optional(),
});

export async function signInAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: WRONG_LOGIN };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: WRONG_LOGIN };
  redirect(safeNext(parsed.data.next));
}

export async function signOutAction() {
  await (await createClient()).auth.signOut();
  redirect("/sign-in");
}
