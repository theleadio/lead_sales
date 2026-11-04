// The CRM's roles (lead_crm lib/auth/permissions.ts, spec §6). lead_sales
// reads app_user, it never writes it, so the list must stay in step with the
// CRM's: a role added there is unknown here until it is added here too.
export const ROLES = [
  "super_admin",
  "management",
  "marketing",
  "sales",
  "support",
  "operations",
  "part_time",
] as const;

export type Role = (typeof ROLES)[number];
