"use client";

import { useActionState, useState } from "react";
import { submitLeadAction, type LeadState } from "./actions";
import { COPY, type Lang } from "./copy";

const field =
  "border-line bg-surface hover:border-ink-muted rounded-xl border px-4 py-3 text-base transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring aria-[invalid=true]:border-danger";

export function LeadForm({
  slug,
  position,
  lang,
  buttonLabel,
}: {
  slug: string;
  position: number;
  lang: Lang;
  buttonLabel: string;
}) {
  const c = COPY[lang];
  const [state, action, pending] = useActionState<LeadState, FormData>(
    submitLeadAction,
    {},
  );
  // One key per page load: a double click can't make a second lead.
  const [key] = useState(() => `page:${crypto.randomUUID()}`);

  if (state.done)
    return (
      <div role="status" className="bg-lead-blue/25 rounded-2xl p-8">
        <p className="text-xl font-semibold">{c.thanks}</p>
        <p className="mt-2">{c.thanksMore}</p>
      </div>
    );

  const input = (
    name: "fullName" | "email" | "phone",
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) => {
    const err = state.fields?.[name];
    return (
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {label}
        <input
          name={name}
          defaultValue={state.values?.[name] ?? ""}
          className={field}
          aria-invalid={Boolean(err)}
          aria-describedby={err ? `${name}-${position}-error` : undefined}
          {...props}
        />
        {err && (
          <span
            id={`${name}-${position}-error`}
            className="text-danger text-xs"
          >
            {err}
          </span>
        )}
      </label>
    );
  };

  return (
    <form
      key={JSON.stringify(state.values ?? {})}
      action={action}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="position" value={position} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.error && (
        <p
          role="alert"
          className="border-danger/40 bg-danger/5 text-danger rounded-xl border px-4 py-3 text-sm"
        >
          {state.error}
        </p>
      )}
      {input("fullName", c.name, {
        required: true,
        maxLength: 200,
        autoComplete: "name",
      })}
      <div className="grid gap-4 sm:grid-cols-2">
        {input("email", c.email, {
          type: "email",
          maxLength: 254,
          autoComplete: "email",
        })}
        {input("phone", c.phone, {
          type: "tel",
          maxLength: 40,
          autoComplete: "tel",
        })}
      </div>
      <p className="text-ink-muted -mt-2 text-sm">{c.contactHint}</p>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="consentMarketing"
          className="accent-charcoal mt-0.5 size-5 shrink-0"
        />
        <span>{c.consent}</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="bg-action text-action-ink hover:bg-ink focus-visible:outline-focus-ring min-h-12 cursor-pointer rounded-full px-7 py-3 text-base font-semibold transition duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none"
      >
        {pending ? c.sending : buttonLabel || c.send}
      </button>
      <p className="text-ink-muted text-sm">{c.privacy}</p>
    </form>
  );
}
