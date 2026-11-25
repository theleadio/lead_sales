"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CreditCard,
  Globe,
  House,
  LogOut,
  Mail,
  Menu,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { LeadProductLogo } from "../logo";
import type { NavGroup, NavIcon } from "./nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  automations: Zap,
  email: Mail,
  social: CalendarDays,
  sites: Globe,
  payments: CreditCard,
};

export type SidebarItem = {
  href: string;
  label: string;
  icon: NavIcon;
  group: NavGroup;
  ready: boolean;
  phase: number;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

// The signed-in menu. On a wide screen it is a column on the left; on a
// phone it is a bar at the top with a button that slides the menu in.
// `counts` holds a small red number per item that needs someone (rendered on
// the server, streamed in, so a slow count never holds the page).
export function Sidebar({
  items,
  user,
  counts,
  signOut,
}: {
  items: SidebarItem[];
  user: { fullName: string; roleLabel: string };
  counts: Partial<Record<string, React.ReactNode>>;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = items.find(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const groups: NavGroup[] = [null, "Marketing", "Sales"];

  return (
    <>
      <div className="border-line bg-surface sticky top-0 z-30 flex items-center gap-2 border-b py-2 pr-4 pl-3 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="text-ink-muted hover:bg-surface-muted hover:text-ink cursor-pointer rounded-lg p-2"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <span className="font-semibold">{current?.label ?? "LEAD Sales"}</span>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        className={`border-line bg-surface-muted fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r px-3 py-[18px] transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-[232px] md:translate-x-0 md:shadow-none ${open ? "translate-x-0 shadow-2xl" : "-translate-x-full max-md:invisible"}`}
      >
        <div className="flex items-center justify-between px-2 pb-5">
          <LeadProductLogo name="Sales" height={30} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="text-ink-muted hover:text-ink cursor-pointer rounded-lg p-1.5 md:hidden"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-0.5 overflow-y-auto text-sm">
          {groups.map((g) => {
            const inGroup = items.filter((i) => i.group === g);
            if (!inGroup.length) return null;
            return (
              <div key={g ?? "top"} className="flex flex-col gap-0.5">
                {g && (
                  <p className="px-2.5 pt-3.5 pb-1.5 text-[11px] tracking-[0.06em] text-[#8a8a90] uppercase">
                    {g}
                  </p>
                )}
                {inGroup.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = item === current;
                  if (!item.ready)
                    return (
                      <span
                        key={item.href}
                        className="text-ink-muted flex items-center gap-2.5 rounded-lg px-2.5 py-2"
                      >
                        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                        {item.label}
                        <span className="bg-lead-yellow text-ink ml-auto rounded-full px-2 text-[11px]">
                          Phase {item.phase}
                        </span>
                      </span>
                    );
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 font-medium transition-colors ${
                        active
                          ? "bg-surface text-ink ring-line shadow-xs ring-1"
                          : "text-ink-muted hover:text-ink hover:bg-hover-nav"
                      }`}
                    >
                      <Icon
                        className={`size-[18px] shrink-0 ${active ? "text-action" : ""}`}
                        aria-hidden="true"
                      />
                      {item.label}
                      {counts[item.href]}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="border-line mt-auto flex items-center gap-2.5 border-t p-2.5">
          <span
            aria-hidden="true"
            className="bg-lead-blue text-ink grid size-[30px] shrink-0 place-items-center rounded-full text-xs font-semibold"
          >
            {initials(user.fullName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{user.fullName}</span>
            <span className="text-ink-muted block truncate text-xs">{user.roleLabel}</span>
          </span>
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="text-ink-muted hover:text-ink hover:bg-hover-nav cursor-pointer rounded-md p-1.5"
            >
              <LogOut className="size-[18px]" aria-hidden="true" />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
