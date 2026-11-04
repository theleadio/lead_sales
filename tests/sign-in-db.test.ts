// Sign-in audit and lockout (lib/auth/sign-in.ts, copied from lead_crm). Runs
// against a database with the CRM schema (DATABASE_URL); skipped without
// one, as in CI. Each test is rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { signIn, signOut, type AuthClient } from "../lib/auth/sign-in.ts";
import { closeDb, db, rollbackAfter } from "../lib/sql.ts";

after(closeDb);

const it = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !process.env.DATABASE_URL && "no DATABASE_URL" }, () =>
    rollbackAfter(fn),
  );

const stub = (right: string): AuthClient => ({
  auth: {
    signInWithPassword: async ({ password }) => ({
      error: password === right ? null : new Error("bad"),
    }),
    signOut: async () => ({}),
  },
});

async function staff(): Promise<{ id: string; email: string }> {
  const email = `staff-${crypto.randomUUID().slice(0, 8)}@lead.test`;
  const [u] = await db()`
    INSERT INTO app_user (email, full_name, role_code)
    VALUES (${email}, 'Test staff', 'sales') RETURNING id`;
  return { id: u.id as string, email };
}

const actions = async (userId: string) =>
  (
    await db()`
      SELECT action FROM audit_log WHERE user_id = ${userId} ORDER BY at, id`
  ).map((r) => r.action as string);

it("a good sign-in is audited in the shared audit_log", async () => {
  const u = await staff();
  assert.deepEqual(
    await signIn(u.email, "right", "198.51.100.4", stub("right")),
    {
      ok: true,
    },
  );
  assert.deepEqual(await actions(u.id), ["sign_in"]);
});

it("5 failures lock the 6th attempt, even with the right password", async () => {
  const u = await staff();
  for (let i = 0; i < 5; i++)
    await signIn(u.email, "wrong", null, stub("right"));
  const r = await signIn(u.email, "right", null, stub("right"));
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /Too many attempts/);
});

it("sign-out is audited for the session user", async () => {
  const u = await staff();
  await signOut({ id: u.id }, null, stub("right"));
  assert.deepEqual(await actions(u.id), ["sign_out"]);
});
