import type { Role } from "../auth/roles.ts";

const EDIT: readonly Role[] = ["super_admin", "management", "marketing"];
const VIEW: readonly Role[] = [...EDIT, "sales", "operations"];

export const canEditSites = (role: Role): boolean => EDIT.includes(role);
export const canViewSites = (role: Role): boolean => VIEW.includes(role);
