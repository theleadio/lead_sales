// Pieces shared by the email marketing pages.

export const RESULTS: Record<string, { text: string; ok: boolean }> = {
  saved: { text: "Saved.", ok: true },
  tested: {
    text: "Saved. A test email is on its way to your address.",
    ok: true,
  },
  queued: {
    text: "Queued. The emails go out in batches within the next few minutes.",
    ok: true,
  },
  notconfigured: {
    text: "Email sending isn't set up yet: it needs RESEND_API_KEY, EMAIL_FROM, APP_BASE_URL and EMAIL_UNSUBSCRIBE_SECRET.",
    ok: false,
  },
  gone: { text: "That campaign is gone or was already sent.", ok: false },
  invalid: {
    text: "That wasn't possible. Check the fields and the audience, then try again.",
    ok: false,
  },
  forbidden: {
    text: "Only marketing, management and super_admin can use email marketing.",
    ok: false,
  },
};

export function ResultNote({ code }: { code: string | undefined }) {
  const r = code ? RESULTS[code] : undefined;
  if (!r) return null;
  return (
    <p
      role={r.ok ? "status" : "alert"}
      className={`mt-4 rounded-xl border px-4 py-3 text-sm ${r.ok ? "border-line bg-surface-muted" : "border-danger/40 bg-danger/5 text-danger"}`}
    >
      {r.text}
    </p>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sending: "Sending",
  sent: "Sent",
};
