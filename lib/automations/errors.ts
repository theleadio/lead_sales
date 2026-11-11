import type { Role } from "../auth/roles.ts";

// Who is acting, and the refusals the automation screens turn into a
// message. These lived with the tickets (lib/tickets/service.ts) until the
// tickets moved to lead_crm (its migration 019).

export type Actor = { id: string; role: Role };

export class AutomationError extends Error {
  readonly code: "not_found" | "forbidden" | "invalid";
  constructor(code: AutomationError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
