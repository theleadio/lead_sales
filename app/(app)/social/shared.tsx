import Link from "next/link";
import {
  CHANNEL_LABEL,
  isReason,
  REASONS,
  STATE_LABEL,
  mytTime,
  postText,
  type PostState,
} from "@/lib/social/planner";
import { CopyButton } from "./copy-button";
import type { Post } from "@/lib/social/social";

// Pieces shared by the social planner pages.

export const RESULTS: Record<string, { text: string; ok: boolean }> = {
  saved: { text: "Saved as a draft. Nothing goes out until it is scheduled.", ok: true },
  scheduled: {
    text: "Scheduled. Facebook posts go out automatically within a few minutes of the time; other channels show up under \"Needs you\" when it's time to post them.",
    ok: true,
  },
  deleted: { text: "Post deleted.", ok: true },
  marked: { text: "Marked as posted.", ok: true },
  retrying: {
    text: "Sent back to the queue. It goes out within a few minutes.",
    ok: true,
  },
  uploaded: { text: "Image added to the library.", ok: true },
  removed: {
    text: "Image removed from the library. Posts that already use it keep it.",
    ok: true,
  },
  gone: { text: "That post or image is gone.", ok: false },
  locked: {
    text: "Part of this post has already gone out, so it can't be changed or deleted.",
    ok: false,
  },
  invalid: {
    text: "That wasn't possible. Check the fields and try again.",
    ok: false,
  },
  forbidden: {
    text: "Only marketing, management and super_admin can use the social planner.",
    ok: false,
  },
};

export function ResultNote({
  code,
  why,
}: {
  code: string | undefined;
  why?: string;
}) {
  const r = code ? RESULTS[code] : undefined;
  if (!r) return null;
  return (
    <p
      role={r.ok ? "status" : "alert"}
      className={`mt-4 rounded-xl border px-4 py-3 text-sm ${r.ok ? "border-line bg-surface-muted" : "border-danger/40 bg-danger/5 text-danger"}`}
    >
      {!r.ok && isReason(why) ? REASONS[why] : r.text}
    </p>
  );
}

const TONE: Record<PostState, string> = {
  draft: "border-line text-ink-muted",
  scheduled: "border-line",
  due: "border-transparent bg-lead-yellow text-ink",
  posting: "border-line",
  posted: "border-transparent bg-lead-blue text-ink",
  partly_posted: "border-line",
  failed: "border-danger/40 bg-danger/5 text-danger",
};

export function StateBadge({ state }: { state: PostState }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${TONE[state]}`}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

export const preview = (p: Post, n = 60) => {
  const t = p.body.replace(/\s+/g, " ").trim();
  if (!t) return p.media.length ? `(${p.media.length} image${p.media.length > 1 ? "s" : ""})` : "(empty)";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const channelList = (p: Post) =>
  p.channels.map((c) => CHANNEL_LABEL[c.channel]).join(", ") || "No channel";

// One post as a small card on the calendar.
export function PostChip({ p }: { p: Post }) {
  return (
    <Link
      href={`/social/${p.id}`}
      className="border-line bg-surface hover:bg-surface-muted block rounded-lg border px-2 py-1 text-xs"
    >
      <span className="flex items-center justify-between gap-1">
        <span className="font-medium">
          {p.scheduledAt ? mytTime(p.scheduledAt) : "—"}
        </span>
        <StateBadge state={p.state} />
      </span>
      <span className="text-ink-muted mt-0.5 block truncate">{preview(p, 40)}</span>
    </Link>
  );
}

// A public storage link that downloads instead of opening (Supabase Storage
// takes ?download=<file name>).
const downloadUrl = (url: string, n: number) =>
  `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`lead-post-${n}${url.match(/\.(jpe?g|png)$/i)?.[0] ?? ""}`)}`;

// What a person needs to post by hand: the text (with the link) to copy, and
// the images to download, in order.
export function HandKit({ p }: { p: Post }) {
  const text = postText(p.body, p.link, true);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {text && <CopyButton text={text} />}
      {p.media.map((m, i) => (
        <a
          key={m.id}
          href={downloadUrl(m.url, i + 1)}
          className="border-line rounded-lg border px-3 py-1 text-sm"
          rel="noopener noreferrer"
        >
          Image {i + 1}
        </a>
      ))}
    </div>
  );
}
