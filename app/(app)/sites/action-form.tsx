"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
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
  id,
}: {
  action: (prev: ActionState, f: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  // Lets a button elsewhere (in a ⋯ menu) submit this form with form={id}.
  id?: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  // A form in a pop-up closes it once it has worked.
  useEffect(() => {
    if (state.ok) ref.current?.closest("dialog")?.close();
  }, [state]);
  return (
    <Errors.Provider value={state.fields ?? {}}>
      <form
        ref={ref}
        id={id}
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
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={bad}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={field}
      />
      {hint && (
        <span id={`${id}-hint`} className="text-ink-muted text-xs">
          {hint}
        </span>
      )}
      <FieldError name={name} />
    </div>
  );
}
