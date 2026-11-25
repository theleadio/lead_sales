// The pure parts of the social planner: channels, Malaysia-time dates, the
// calendar grid and what state a post is in. No database here, so tests run
// without one.

export const CHANNELS = [
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube",
  "x",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
};

// Channels the background job posts to. Every other channel is posted by a
// person, who then marks it posted.
export const AUTO_CHANNELS: readonly Channel[] = ["facebook"];
export const isAuto = (c: Channel) => AUTO_CHANNELS.includes(c);
// An automatic channel still waiting this long after its time was not posted
// by the job (Facebook isn't set up yet, or the job is behind), so it is
// handed to a person like any other channel.
export const AUTO_GRACE_MS = 15 * 60 * 1000;

// A channel a person should post now: a manual one whose time has come, or
// an automatic one the job hasn't posted within the grace period.
export function needsHand(
  c: { channel: Channel; status: string },
  scheduledAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (c.status !== "pending" || !scheduledAt) return false;
  const late = now.getTime() - scheduledAt.getTime();
  return isAuto(c.channel) ? late >= AUTO_GRACE_MS : late >= 0;
}

export const isChannel = (c: string): c is Channel =>
  (CHANNELS as readonly string[]).includes(c);

export const MAX_BODY = 5000;
export const MAX_IMAGES = 10;

// ---- Malaysia time ----------------------------------------------------------
// The office is in Malaysia (UTC+8, no daylight saving), so every time a
// person types or reads is Malaysia time.

const OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

// "2026-11-25T14:30" (a datetime-local value, Malaysia time) as a Date, or
// null when it isn't a real date and time.
export function parseMyt(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi) - OFFSET_MS;
  // 31 Feb rolls over to March: refuse it rather than move it.
  if (new Date(utc + OFFSET_MS).getUTCDate() !== d) return null;
  return new Date(utc);
}

// A Date as a datetime-local value in Malaysia time.
export function toMytInput(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

// The Malaysia calendar day a moment falls on, as "YYYY-MM-DD".
export function mytDay(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

// "14:30", Malaysia time.
export function mytTime(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

// The moment a Malaysia calendar day starts.
export function dayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
}

export function isDay(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return mytDay(dayStart(s)) === s;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Monday of the week the day is in.
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: string, n: number): string {
  const [y, m] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

// The weeks (Monday first) covering the month the day is in: each a list of
// seven "YYYY-MM-DD" days, including the spill-over days of the months
// either side.
export function monthGrid(day: string): string[][] {
  const first = monthStart(day);
  const next = addMonths(first, 1);
  const weeks: string[][] = [];
  for (let w = weekStart(first); w < next; w = addDays(w, 7))
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  return weeks;
}

// ---- A post's state ---------------------------------------------------------

export type ChannelState = {
  channel: Channel;
  status: "pending" | "publishing" | "posted" | "failed";
};

export type PostState =
  | "draft"
  | "scheduled"
  | "due"
  | "posting"
  | "posted"
  | "partly_posted"
  | "failed";

export const STATE_LABEL: Record<PostState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  due: "Due",
  posting: "Posting",
  posted: "Posted",
  partly_posted: "Partly posted",
  failed: "Failed",
};

// One word for the whole post, from its channels. "due" means a channel
// waits for a person to post it (see needsHand).
export function postState(
  p: { status: "draft" | "scheduled"; scheduledAt: Date | null },
  channels: ChannelState[],
  now: Date = new Date(),
): PostState {
  if (p.status === "draft") return "draft";
  if (channels.some((c) => c.status === "failed")) return "failed";
  if (channels.some((c) => c.status === "publishing")) return "posting";
  const posted = channels.filter((c) => c.status === "posted").length;
  if (channels.length > 0 && posted === channels.length) return "posted";
  if (channels.some((c) => needsHand(c, p.scheduledAt, now))) return "due";
  return posted > 0 ? "partly_posted" : "scheduled";
}

// A post can be changed only while nothing of it has gone out.
export const isEditable = (channels: ChannelState[]) =>
  channels.every((c) => c.status === "pending");

// What gets posted as the text: the words, with the link on its own line
// when the platform can't attach it (a photo post can't carry a link card).
export function postText(body: string, link: string | null, withLink: boolean) {
  const b = body.trim();
  if (!withLink || !link) return b;
  return b ? `${b}\n\n${link}` : link;
}

// ---- Why something was refused ----------------------------------------------
// Refusals travel to the page as a short key in the URL, so a crafted link
// can only ever show one of these sentences.

export const REASONS = {
  retry_failed_only: "Only a failed post can be retried.",
  pick_time: "Pick a date and time.",
  pick_channel: "Pick at least one channel.",
  bad_time: "That date and time isn't valid.",
  time_passed: "That time has passed. Pick a later one.",
  file_empty: "The file is empty.",
  image_too_big: "The image is larger than 4 MB.",
  bad_link: "The link must start with https://.",
  empty_post: "The post is empty: add some text, an image or a link.",
  unknown_channel: "Unknown channel.",
  unknown_image: "Unknown image.",
  image_type: "Use a JPG or PNG image.",
  too_many_images: `At most ${MAX_IMAGES} images.`,
  text_too_long: `The text is longer than ${MAX_BODY} characters.`,
  cant_mark: "That channel can't be marked posted. Is the post scheduled?",
} as const;
export type Reason = keyof typeof REASONS;
export const isReason = (s: string | undefined): s is Reason =>
  !!s && Object.hasOwn(REASONS, s);
