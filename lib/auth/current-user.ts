import { cache } from "react";
import { db } from "../sql";
import { ROLES, type Role } from "./roles";
import { getSession } from "./server";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
};

// The signed-in Supabase user maps to the CRM's app_user through
// auth_user_id, exactly as in lead_crm, so staff have one account and one
// role in both apps. A deactivated or unlinked user gets null (no access).
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session) return null;
  const [user] = await db()`
    SELECT id, email, full_name, role_code FROM app_user
    WHERE auth_user_id = ${session.id} AND is_active`;
  if (!user || !ROLES.includes(user.role_code)) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role_code,
  };
});
