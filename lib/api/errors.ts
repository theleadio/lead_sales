// Copied from lead_crm lib/api/errors.ts: the same JSON error shape, so a
// client sees one format from either app.
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
