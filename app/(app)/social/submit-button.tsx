"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

// A submit button that shows its form is being sent: it is disabled and says
// so until the page comes back. Saving takes a few seconds on the live site,
// and without this people clicked again (one New post click each time made
// another empty draft).
export function SubmitButton({
  children,
  pending: pendingLabel = "Saving…",
  className = "",
  ...rest
}: Omit<ComponentProps<"button">, "type"> & { pending?: ReactNode }) {
  const { pending, data } = useFormStatus();
  // In a form with two submit buttons (Schedule / Save draft), only the one
  // pressed changes its words; both are disabled.
  const mine =
    pending &&
    (rest.name === undefined || data?.get(rest.name) === rest.value);
  return (
    <button
      type="submit"
      {...rest}
      disabled={pending || rest.disabled}
      aria-busy={mine || undefined}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
    >
      {mine ? pendingLabel : children}
    </button>
  );
}
