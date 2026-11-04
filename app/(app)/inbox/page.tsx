// Phase 0's "done when": a staff member signs in and sees this empty Inbox
// (build plan §3). Phase 1 fills it: WATI, Messenger, Instagram, email and
// the help form, with tickets (inbox-tickets draft).
export default function InboxPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Inbox</h1>
      <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
        <p className="font-medium">No conversations yet</p>
        <p className="text-ink-muted mt-1 text-sm">
          WhatsApp, Messenger, Instagram, email and help-form messages will
          appear here once phase 1 is built.
        </p>
      </div>
    </section>
  );
}
