import type { ZodError } from "zod";
import { clientIp, writeAudit } from "../audit.ts";

// Copied from lead_crm lib/api/errors.ts: the same JSON error shape, so a
// client sees one format from either app, and the same audited 403.
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: { code, message, ...(details ?? {}) } },
    { status },
  );
}

export function validationError(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  return apiError(400, "validation_failed", "Check the highlighted fields.", {
    fields,
  });
}

// Spec §6: every denied call is audited (permission_denied) in the shared
// audit_log, then answered 403.
export async function forbidden(
  viewer: { id: string },
  request: Request,
  { what, resource }: { what: string; resource: string },
) {
  try {
    await writeAudit({
      userId: viewer.id,
      action: "permission_denied",
      entity: resource,
      entityId: null,
      before: null,
      after: { route: new URL(request.url).pathname, method: request.method },
      ip: clientIp(request.headers.get("x-forwarded-for")),
    });
  } catch (err) {
    console.error("permission_denied audit failed", err);
  }
  return apiError(
    403,
    "forbidden",
    `You don't have access to ${what}. Ask a super admin if you need it.`,
  );
}
