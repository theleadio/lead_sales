"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// A ⋯ button that opens a short list of actions. Items are buttons or links
// (style them with `menuItem` from ui.tsx); a button can submit a form kept
// outside the menu with form="…", so its message shows where people see it.
// The list stays in the page while closed (hidden), so a click on an item
// still submits after the menu shuts.
export function Menu({
  label = "More actions",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="bg-surface text-ink ring-line hover:bg-surface-muted inline-flex size-[38px] cursor-pointer items-center justify-center rounded-lg ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <Ellipsis className="size-[18px]" aria-hidden="true" />
      </button>
      <div
        role="menu"
        hidden={!open}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("button:not(:disabled), a")) setOpen(false);
        }}
        className="border-line bg-surface absolute top-[calc(100%+6px)] right-0 z-30 w-60 rounded-xl border p-1.5 shadow-[0_10px_30px_rgba(0,0,0,.12)]"
      >
        {children}
      </div>
    </div>
  );
}

export function MenuSeparator() {
  return <hr className="border-line my-1" />;
}

// A pop-up with a title. Open it with <OpenDialog target={id}>; a click on
// the dimmed backdrop or Esc closes it, as does a form in it that worked.
export function Dialog({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <dialog
      id={id}
      aria-labelledby={`${id}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="bg-surface text-ink m-auto w-[min(480px,calc(100vw-32px))] rounded-2xl p-0 shadow-[0_20px_50px_rgba(0,0,0,.2)] backdrop:bg-black/35"
    >
      <div className="p-[22px]">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        {lede && <p className="text-ink-muted text-sm">{lede}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

export function OpenDialog({
  target,
  className,
  role,
  children,
}: {
  target: string;
  className?: string;
  role?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      className={className}
      onClick={() =>
        (document.getElementById(target) as HTMLDialogElement | null)?.showModal()
      }
    >
      {children}
    </button>
  );
}

export function CloseDialog({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => e.currentTarget.closest("dialog")?.close()}
    >
      {children}
    </button>
  );
}
