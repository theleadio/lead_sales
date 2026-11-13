"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  type ReactNode,
} from "react";
import type { ActionState } from "@/lib/sites/admin-actions";
import { field } from "../ui";

// A form wired to a server action that answers with an ActionState: shows its
// message and, through <Field>, per-field errors. Submits by hand so a failed
// save keeps what was typed (React would reset an action form).
const Errors = createContext<Record<string, string>>({});

export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: (prev: ActionState, f: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <Errors.Provider value={state.fields ?? {}}>
      <form
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm && !window.confirm(confirm)) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => run(data));
        }}
      >
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
        {state.error && (
          <p role="alert" className="text-danger mt-2 text-sm">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" className="text-ink-muted mt-2 text-sm">
            {state.ok}
          </p>
        )}
      </form>
    </Errors.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const e = useContext(Errors)[name];
  return e ? (
    <span role="alert" className="text-danger text-xs">
      {e}
    </span>
  ) : null;
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  hint,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  hint?: string;
  required?: boolean;
}) {
  const bad = !!useContext(Errors)[name];
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={bad}
        className={field}
      />
      {hint && <span className="text-ink-muted text-xs">{hint}</span>}
      <FieldError name={name} />
    </label>
  );
}
