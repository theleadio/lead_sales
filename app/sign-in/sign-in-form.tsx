"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInAction } from "@/lib/auth/actions";

const field =
  "border-line bg-surface text-ink focus-visible:outline-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

export function SignInForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className={field}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className={field}
        />
      </div>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="bg-action text-action-ink focus-visible:outline-focus-ring w-full cursor-pointer rounded-full py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-ink-muted text-xs">Same account as the LEAD CRM.</p>
    </form>
  );
}
