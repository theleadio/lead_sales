import Link from "next/link";
import {
  type Channel,
  CHANNEL_LABEL,
  isReason,
  REASONS,
  STATE_LABEL,
  mytTime,
  postText,
  type PostState,
} from "@/lib/social/planner";
import { CopyButton } from "./copy-button";
import { Badge, type Tone } from "../ui";
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

const TONE: Record<PostState, Tone> = {
  draft: "grey",
  scheduled: "blue",
  due: "amber",
  posting: "amber",
  posted: "green",
  partly_posted: "amber",
  failed: "red",
};
export const stateTone = (state: PostState): Tone => TONE[state];

export function StateBadge({ state }: { state: PostState }) {
  return <Badge tone={TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

export const preview = (p: Post, n = 60) => {
  const t = p.body.replace(/\s+/g, " ").trim();
  if (!t) return p.media.length ? `(${p.media.length} image${p.media.length > 1 ? "s" : ""})` : "(empty)";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const channelList = (p: Post) =>
  p.channels.map((c) => CHANNEL_LABEL[c.channel]).join(", ") || "No channel";

// Each channel as a small coloured square on calendar cards.
const CHIP: Record<Channel, { text: string; bg: string }> = {
  facebook: { text: "f", bg: "#1f4fa8" },
  instagram: { text: "ig", bg: "#a8326d" },
  linkedin: { text: "in", bg: "#135f8f" },
  tiktok: { text: "tt", bg: "#111111" },
  youtube: { text: "yt", bg: "#b31b1b" },
  x: { text: "x", bg: "#0a0a0a" },
};

export function ChannelChips({ p }: { p: Post }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {p.channels.map((c) => (
        <span
          key={c.channel}
          title={CHANNEL_LABEL[c.channel]}
          aria-label={CHANNEL_LABEL[c.channel]}
          className="grid size-3.5 place-items-center rounded text-[9px] leading-none font-bold text-white"
          style={{ background: CHIP[c.channel].bg }}
        >
          {CHIP[c.channel].text}
        </span>
      ))}
    </span>
  );
}

// One post as a small card on the calendar: its first image, its words and
// its channels. A failed post is red; a draft is faded.
export function PostChip({ p }: { p: Post }) {
  const failed = p.state === "failed";
  return (
    <Link
      href={`/social/${p.id}`}
      title={`${p.scheduledAt ? `${mytTime(p.scheduledAt)} · ` : ""}${STATE_LABEL[p.state]} · ${preview(p, 120)}`}
      className={`flex items-center gap-1.5 rounded-lg p-1 text-xs ${failed ? "bg-danger-soft ring-[#f3c4bf]" : "bg-surface ring-line hover:bg-hover-row"} ring-1 ring-inset ${p.state === "draft" ? "opacity-70" : ""}`}
    >
      {p.media[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.media[0].url} alt="" className="size-[26px] shrink-0 rounded-md object-cover" />
      ) : (
        <span aria-hidden="true" className="from-lead-blue to-info size-[26px] shrink-0 rounded-md bg-gradient-to-br" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {p.scheduledAt && (
          <span className="text-ink-muted">{mytTime(p.scheduledAt)} </span>
        )}
        {preview(p, 40)}
      </span>
      <ChannelChips p={p} />
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
