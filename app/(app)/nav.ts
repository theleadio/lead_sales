import type { Role } from "@/lib/auth/roles";

// The v1 modules (lead_sales spec §4, build plan §3). `ready` turns an item
// into a link once its phase ships; until then it shows its phase. `roles`
// limits who sees an item (the page checks again).
//
// Inbox and tickets moved to lead_crm (its migration 019, 11 Nov): the CRM
// is the one support queue.
//
// `icon` names a sidebar icon (sidebar.tsx) and `group` the heading it sits
// under; items keep this order within their group.
export type NavIcon = "home" | "automations" | "email" | "social" | "sites" | "payments";
export type NavGroup = "Marketing" | "Sales" | null;

export const NAV: readonly {
  href: string;
  label: string;
  phase: number;
  ready: boolean;
  icon: NavIcon;
  group: NavGroup;
  roles?: readonly Role[];
}[] = [
  { href: "/home", label: "Home", phase: 0, ready: true, icon: "home", group: null },
  {
    href: "/email",
    label: "Email marketing",
    phase: 3,
    ready: true,
    icon: "email",
    group: "Marketing",
    roles: ["super_admin", "management", "marketing"],
  },
  {
    href: "/social",
    label: "Social planner",
    phase: 3,
    ready: true,
    icon: "social",
    group: "Marketing",
    roles: ["super_admin", "management", "marketing"],
  },
  {
    href: "/sites",
    label: "Sites & forms",
    phase: 4,
    ready: true,
    icon: "sites",
    group: "Marketing",
    roles: ["super_admin", "management", "marketing", "sales", "operations"],
  },
  {
    href: "/automations",
    label: "Automations",
    phase: 2,
    ready: true,
    icon: "automations",
    group: "Sales",
    roles: ["super_admin", "management", "sales"],
  },
  {
    href: "/payments",
    label: "Payments",
    phase: 2,
    ready: true,
    icon: "payments",
    group: "Sales",
    // The CRM's payment read (spec §6); sales see their own deals only.
    roles: ["super_admin", "management", "sales", "operations"],
  },
];
