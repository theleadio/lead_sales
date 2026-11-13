import type { Role } from "@/lib/auth/roles";

// The v1 modules (lead_sales spec §4, build plan §3). `ready` turns an item
// into a link once its phase ships; until then it shows its phase. `roles`
// limits who sees an item (the page checks again).
//
// Inbox and tickets moved to lead_crm (its migration 019, 11 Nov): the CRM
// is the one support queue.
export const NAV: readonly {
  href: string;
  label: string;
  phase: number;
  ready: boolean;
  roles?: readonly Role[];
}[] = [
  { href: "/home", label: "Home", phase: 0, ready: true },
  {
    href: "/automations",
    label: "Automations",
    phase: 2,
    ready: true,
    roles: ["super_admin", "management", "sales"],
  },
  { href: "/email", label: "Email marketing", phase: 3, ready: false },
  { href: "/social", label: "Social planner", phase: 3, ready: false },
  {
    href: "/sites",
    label: "Sites & forms",
    phase: 4,
    ready: true,
    roles: ["super_admin", "management", "marketing", "sales", "operations"],
  },
  { href: "/payments", label: "Payments", phase: 2, ready: false },
];
