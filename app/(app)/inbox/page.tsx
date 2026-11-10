import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  CONVERSATION_CHANNELS,
  conversationDetail,
  inboxAgents,
  listConversations,
  seesWholeInbox,
  type ConversationChannel,
  type ConversationDetail,
  type InboxFilter,
  type InboxItem,
} from "@/lib/inbox/service";
import { watiFromEnv } from "@/lib/wati/send";
import { activeCategories } from "@/lib/tickets/read";
import { button, ErrorNote, field, myt, StatusPill } from "../tickets/ui";
import {
  assignConversationAction,
  conversationStatusAction,
  makeTicketAction,
  sendReplyAction,
} from "./actions";

// The inbox (inbox spec §5): conversations on the left, the open one on the
// right with the customer, its tickets and "Make ticket". The help form
// feeds it today; WhatsApp, Messenger, Instagram and email join it as each
// is connected. Replies are sent once a channel is connected (WATI first).

const CHANNEL_LABEL: Record<ConversationChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  messenger: "Messenger",
  instagram: "Instagram",
  web_form: "Help form",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const actor = { id: user.id, role: user.role };
  const q = await searchParams;

  const channel =
    CONVERSATION_CHANNELS.find((c) => c === one(q.channel)) ?? "all";
  const who =
    (["mine", "unassigned", "all"] as const).find((w) => w === one(q.who)) ??
    "all";
  const status =
    (["open", "closed", "all"] as const).find((s) => s === one(q.status)) ??
    "open";
  const needsReply = one(q.reply) === "1";
  const filter: InboxFilter = { channel, who, status, needsReply };

  const selectedId = one(q.c);
  const [items, selected] = await Promise.all([
    listConversations(actor, filter),
    selectedId ? conversationDetail(actor, selectedId) : Promise.resolve(null),
  ]);

  const params = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      channel,
      who,
      status,
      ...(needsReply ? { reply: "1" } : {}),
      ...(selectedId ? { c: selectedId } : {}),
      ...over,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/inbox?${p}`;
  };

  return (
    <section className="flex h-full flex-col">
      <h1 className="text-2xl font-semibold">Inbox</h1>
      <ErrorNote code={one(q.error)} />
      {!seesWholeInbox(user.role) && (
        <p className="text-ink-muted mt-1 text-sm">
          You see conversations linked to your teams&apos; tickets.
        </p>
      )}

      <nav
        aria-label="Inbox filters"
        className="mt-4 flex flex-wrap gap-2 text-sm"
      >
        {(["all", "mine", "unassigned"] as const).map((w) => (
          <Chip key={w} href={params({ who: w, c: "" })} on={who === w}>
            {w === "all" ? "Everyone's" : w === "mine" ? "Mine" : "Unassigned"}
          </Chip>
        ))}
        <span className="border-line mx-1 border-l" />
        <Chip
          href={params({ reply: needsReply ? "" : "1", c: "" })}
          on={needsReply}
        >
          Needs reply
        </Chip>
        <span className="border-line mx-1 border-l" />
        {(["open", "closed", "all"] as const).map((s) => (
          <Chip key={s} href={params({ status: s, c: "" })} on={status === s}>
            {s === "all" ? "Any status" : s[0].toUpperCase() + s.slice(1)}
          </Chip>
        ))}
        <span className="border-line mx-1 border-l" />
        <Chip href={params({ channel: "all", c: "" })} on={channel === "all"}>
          All channels
        </Chip>
        {CONVERSATION_CHANNELS.map((ch) => (
          <Chip
            key={ch}
            href={params({ channel: ch, c: "" })}
            on={channel === ch}
          >
            {CHANNEL_LABEL[ch]}
          </Chip>
        ))}
      </nav>

      <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <ConversationList
          items={items}
          selectedId={selectedId}
          hrefFor={(c) => params({ c })}
        />
        {selected ? (
          <Thread c={selected} />
        ) : (
          <div className="border-line bg-surface-muted hidden rounded-2xl border p-10 text-center lg:block">
            <p className="font-medium">
              {selectedId
                ? "That conversation isn't available."
                : "Pick a conversation"}
            </p>
            <p className="text-ink-muted mt-1 text-sm">
              Help-form messages are here now. WhatsApp, Messenger, Instagram
              and email arrive as each channel is connected.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Chip({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-full px-3 py-1 ${on ? "bg-lead-blue/60 font-medium" : "hover:bg-surface-muted"}`}
    >
      {children}
    </Link>
  );
}

function ConversationList({
  items,
  selectedId,
  hrefFor,
}: {
  items: InboxItem[];
  selectedId: string | undefined;
  hrefFor: (id: string) => string;
}) {
  if (items.length === 0)
    return (
      <div className="border-line bg-surface-muted rounded-2xl border p-8 text-center">
        <p className="font-medium">No conversations here</p>
        <p className="text-ink-muted mt-1 text-sm">Try another filter.</p>
      </div>
    );
  return (
    <ul className="border-line divide-line flex flex-col divide-y overflow-y-auto rounded-2xl border">
      {items.map((i) => (
        <li key={i.id}>
          <Link
            href={hrefFor(i.id)}
            aria-current={i.id === selectedId ? "true" : undefined}
            className={`block px-4 py-3 text-sm ${i.id === selectedId ? "bg-lead-blue/30" : "hover:bg-surface-muted"}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{i.personName}</span>
              <span className="text-ink-muted shrink-0 text-xs">
                {i.lastMessageAt ? myt(i.lastMessageAt) : ""}
              </span>
            </span>
            <span className="text-ink-muted mt-0.5 flex items-center gap-2 text-xs">
              <span>{CHANNEL_LABEL[i.channel]}</span>
              {i.lastDirection === "in" && (
                <span className="bg-lead-yellow text-ink rounded-full px-1.5">
                  needs reply
                </span>
              )}
              {i.openTickets > 0 && (
                <span>
                  {i.openTickets} open ticket{i.openTickets > 1 ? "s" : ""}
                </span>
              )}
              <span className="ml-auto truncate">
                {i.assigneeName ?? "Unassigned"}
              </span>
            </span>
            {i.preview && (
              <span className="text-ink-muted mt-1 line-clamp-2 text-xs">
                {i.preview}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Thread({ c }: { c: ConversationDetail }) {
  const [categories, agents] = await Promise.all([
    activeCategories(),
    inboxAgents(),
  ]);
  const lastIn = [...c.messages].reverse().find((m) => m.direction === "in");
  const firstLine = (lastIn?.body ?? "").split(/\r?\n/)[0].trim().slice(0, 200);
  return (
    <div className="border-line flex min-w-0 flex-col rounded-2xl border">
      <header className="border-line flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="font-semibold">{c.person.fullName}</p>
          <p className="text-ink-muted truncate text-xs">
            {[CHANNEL_LABEL[c.channel], c.person.email, c.person.phone]
              .filter(Boolean)
              .join(" · ")}
            {c.person.needsReview &&
              " · flagged as a possible duplicate in the CRM"}
          </p>
        </div>
        <form
          action={assignConversationAction}
          className="ml-auto flex items-center gap-2"
        >
          <input type="hidden" name="conversationId" value={c.id} />
          <label htmlFor="assign" className="sr-only">
            Assign conversation
          </label>
          <select
            id="assign"
            name="userId"
            defaultValue={c.assignedUserId ?? ""}
            className={field}
          >
            <option value="">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="submit" className={button}>
            Assign
          </button>
        </form>
        <form action={conversationStatusAction}>
          <input type="hidden" name="conversationId" value={c.id} />
          <input
            type="hidden"
            name="status"
            value={c.status === "closed" ? "open" : "closed"}
          />
          <button
            type="submit"
            className="border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-2 text-sm"
          >
            {c.status === "closed" ? "Reopen" : "Close"}
          </button>
        </form>
      </header>

      <ol className="flex flex-col gap-3 overflow-y-auto p-4">
        {c.messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.direction === "in" ? "bg-surface-muted self-start" : "bg-lead-blue/40 self-end"}`}
          >
            <p className="break-words whitespace-pre-wrap">
              {m.body ?? "(no text)"}
            </p>
            <p className="text-ink-muted mt-1 text-xs">
              {m.direction === "out" ? `${m.senderName ?? "LEAD"} · ` : ""}
              {myt(m.sentAt)}
              {m.attachments > 0 &&
                ` · ${m.attachments} attachment${m.attachments > 1 ? "s" : ""}`}
            </p>
          </li>
        ))}
      </ol>

      <div className="border-line mt-auto border-t p-4">
        {c.tickets.length > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Tickets</h2>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {c.tickets.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  {t.canOpen ? (
                    <Link
                      href={`/tickets/${t.id}`}
                      className="font-medium underline"
                    >
                      {t.number}
                    </Link>
                  ) : (
                    <span className="font-medium">{t.number}</span>
                  )}
                  <span className="truncate">
                    {t.subject ?? "(another team's ticket)"}
                  </span>
                  <span className="text-ink-muted text-xs">{t.teamName}</span>
                  <StatusPill status={t.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <form
          action={makeTicketAction}
          className="grid gap-2 sm:grid-cols-[180px_1fr_auto]"
        >
          <input type="hidden" name="conversationId" value={c.id} />
          <label htmlFor="category" className="sr-only">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={c.suggestedCategory ?? "general"}
            className={field}
          >
            {categories.map((cat) => (
              <option key={cat.code} value={cat.code}>
                {cat.label} ({cat.teamName})
                {cat.code === c.suggestedCategory ? " · suggested" : ""}
              </option>
            ))}
          </select>
          <label htmlFor="subject" className="sr-only">
            Ticket subject
          </label>
          <input
            id="subject"
            name="subject"
            required
            maxLength={200}
            defaultValue={firstLine}
            placeholder="Subject"
            className={field}
          />
          <button type="submit" className={button}>
            Make ticket
          </button>
        </form>

        {c.channel === "whatsapp" &&
          c.replyWindow === "open" &&
          watiFromEnv() && (
            <form action={sendReplyAction} className="mt-4 grid gap-2">
              <input type="hidden" name="conversationId" value={c.id} />
              <textarea
                name="text"
                required
                maxLength={4000}
                rows={3}
                placeholder="Reply on WhatsApp"
                className={field}
              />
              <button type="submit" className={button}>
                Send
              </button>
            </form>
          )}

        <p className="text-ink-muted mt-3 text-xs">
          {c.channel === "web_form"
            ? "Help-form messages can't be answered here yet: reply by email or phone until email replies are connected."
            : c.replyWindow === "closed"
              ? "The free-reply window has closed: WhatsApp needs an approved template to reply."
              : c.channel === "whatsapp" && watiFromEnv()
                ? "Replies go out on WhatsApp from here."
                : "Replies are sent from here once this channel is connected."}
        </p>
      </div>
    </div>
  );
}
