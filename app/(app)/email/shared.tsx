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
  scheduled: {
    text: "Scheduled. It goes out at that time (within about 5 minutes), to everyone who matches and has consent then.",
    ok: true,
  },
  unscheduled: {
    text: "Schedule cancelled. It is a draft again, so you can change it.",
    ok: true,
  },
  duplicated: {
    text: "Copied. This is a new draft with the same email and audience.",
    ok: true,
  },
  badtime: {
    text: "Pick a time at least 10 minutes from now and within the next year (Malaysia time).",
    ok: false,
  },
  badblock: {
    text: "Not saved: a block isn't complete. Buttons need a label and an https:// link, and images need an https:// address.",
    ok: false,
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
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-surface-muted text-ink-muted",
  scheduled: "bg-lead-blue/40 text-ink",
  sending: "bg-lead-yellow/60 text-ink",
  sent: "bg-surface-muted text-ink",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
