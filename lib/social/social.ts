import type postgres from "postgres";
import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { isUuid } from "../crm/people.ts";
import { imageType, type ImageStore } from "../sites/images.ts";
import { db, withTransaction } from "../sql.ts";
import {
  publishToFacebook,
  type FacebookConfig,
} from "./facebook.ts";
import {
  isAuto,
  isChannel,
  isEditable,
  MAX_BODY,
  MAX_IMAGES,
  postState,
  REASONS,
  isReason,
  type Channel,
  type Reason,
  type ChannelState,
  type PostState,
} from "./planner.ts";

// The social planner: posts on a calendar, an image library, and the job that
// posts to the Facebook Page. Every function that changes something takes
// the actor first; a refusal is audited and throws.

export type Actor = { id: string; role: Role };

export class SocialError extends Error {
  // Not parameter properties: Node runs this file with types stripped.
  readonly code: "forbidden" | "not_found" | "invalid" | "locked";
  // For "invalid": which rule, so the page can say what to fix.
  readonly reason: Reason | null;
  constructor(code: SocialError["code"], messageOrReason: string) {
    const reason = isReason(messageOrReason) ? messageOrReason : null;
    super(reason ? REASONS[reason] : messageOrReason);
    this.code = code;
    this.reason = reason;
  }
}

// Marketing's own tool, plus the two management roles (as email marketing).
const EDITORS: readonly Role[] = ["super_admin", "management", "marketing"];
export const canUseSocial = (role: Role) => EDITORS.includes(role);

async function guard(actor: Actor, what: string) {
  if (canUseSocial(actor.role)) return;
  await writeAudit({
    userId: actor.id,
    action: "permission_denied",
    entity: "social_post",
    entityId: null,
    before: null,
    after: { what },
  });
  throw new SocialError(
    "forbidden",
    "Only marketing, management and super_admin can use the social planner.",
  );
}

// ---- Image library ----------------------------------------------------------

// Facebook takes JPEG and PNG from a link; it documents a 4 MB limit for
// photos, so the library keeps to that.
export const MAX_SOCIAL_IMAGE_BYTES = 4 * 1024 * 1024;

export type Media = {
  id: string;
  url: string;
  name: string;
  bytes: number;
  createdAt: Date;
};

const toMedia = (r: postgres.Row): Media => ({
  id: r.id,
  url: r.url,
  name: r.name,
  bytes: r.bytes,
  createdAt: r.created_at,
});

export async function listMedia(limit = 200): Promise<Media[]> {
  const rows = await db()`
    SELECT id, url, name, bytes, created_at FROM sales.social_media
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows.map(toMedia);
}

// Checks the file is a JPEG or PNG (by its first bytes, not its name) of at
// most 4 MB, stores it and adds it to the library.
export async function uploadMedia(
  actor: Actor,
  file: { bytes: Uint8Array; name: string },
  store: ImageStore,
): Promise<Media> {
  await guard(actor, "upload a social image");
  if (file.bytes.length === 0)
    throw new SocialError("invalid", "file_empty");
  if (file.bytes.length > MAX_SOCIAL_IMAGE_BYTES)
    throw new SocialError("invalid", "image_too_big");
  const type = imageType(file.bytes);
  if (!type || (type.ext !== "jpg" && type.ext !== "png"))
    throw new SocialError("invalid", "image_type");
  const key = `social/${crypto.randomUUID()}.${type.ext}`;
  const url = await store(key, file.bytes, type.mime);
  const name = file.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  const [r] = await db()`
    INSERT INTO sales.social_media (created_by, url, storage_key, mime, bytes, name)
    VALUES (${actor.id}, ${url}, ${key}, ${type.mime}, ${file.bytes.length}, ${name})
    RETURNING id, url, name, bytes, created_at`;
  await writeAudit({
    userId: actor.id,
    action: "create",
    entity: "social_media",
    entityId: r.id,
    before: null,
    after: { key, bytes: file.bytes.length },
  });
  return toMedia(r);
}

// Hides an image from the library. The file stays in storage, so a post that
// already uses it still shows it and can still be published.
export async function removeMedia(actor: Actor, id: string): Promise<void> {
  await guard(actor, "remove a social image");
  if (!isUuid(id)) throw new SocialError("not_found", "That image is gone.");
  const [r] = await db()`
    UPDATE sales.social_media SET deleted_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  if (!r) throw new SocialError("not_found", "That image is gone.");
  await writeAudit({
    userId: actor.id,
    action: "delete",
    entity: "social_media",
    entityId: id,
    before: null,
    after: null,
  });
}

// ---- Posts ------------------------------------------------------------------

export type PostChannel = ChannelState & {
  attempts: number;
  error: string | null;
  postedAt: Date | null;
  externalUrl: string | null;
};

export type Post = {
  id: string;
  body: string;
  link: string | null;
  mediaIds: string[];
  // In mediaIds' order; an image removed from the library still shows.
  media: { id: string; url: string }[];
  scheduledAt: Date | null;
  status: "draft" | "scheduled";
  createdAt: Date;
  channels: PostChannel[];
  state: PostState;
};

const POST_SELECT = (sql: ReturnType<typeof db>) => sql`
  SELECT p.*,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'channel', c.channel, 'status', c.status, 'attempts', c.attempts,
               'error', c.error, 'postedAt', c.posted_at,
               'externalUrl', c.external_url)
             ORDER BY c.channel)
      FROM sales.social_post_channel c WHERE c.post_id = p.id), '[]') AS channels,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'url', m.url)
             ORDER BY array_position(p.media_ids, m.id))
      FROM sales.social_media m WHERE m.id = ANY(p.media_ids)), '[]') AS media
  FROM sales.social_post p`;

function toPost(r: postgres.Row, now: Date): Post {
  const channels: PostChannel[] = (r.channels as Record<string, unknown>[]).map(
    (c) => ({
      channel: c.channel as Channel,
      status: c.status as PostChannel["status"],
      attempts: c.attempts as number,
      error: (c.error as string | null) ?? null,
      postedAt: c.postedAt ? new Date(c.postedAt as string) : null,
      externalUrl: (c.externalUrl as string | null) ?? null,
    }),
  );
  const p = {
    status: r.status as Post["status"],
    scheduledAt: r.scheduled_at as Date | null,
  };
  return {
    id: r.id,
    body: r.body,
    link: r.link,
    mediaIds: r.media_ids,
    media: r.media,
    scheduledAt: p.scheduledAt,
    status: p.status,
    createdAt: r.created_at,
    channels,
    state: postState(p, channels, now),
  };
}

// Posts with a time in [from, to), soonest first.
export async function listPostsBetween(from: Date, to: Date): Promise<Post[]> {
  const sql = db();
  const now = new Date();
  const rows = await sql`
    ${POST_SELECT(sql)}
    WHERE p.scheduled_at >= ${from} AND p.scheduled_at < ${to}
    ORDER BY p.scheduled_at, p.created_at
    LIMIT 1000`;
  return rows.map((r) => toPost(r, now));
}

// Drafts that have no time yet, newest first.
export async function listUntimedDrafts(): Promise<Post[]> {
  const sql = db();
  const now = new Date();
  const rows = await sql`
    ${POST_SELECT(sql)}
    WHERE p.scheduled_at IS NULL
    ORDER BY p.created_at DESC
    LIMIT 100`;
  return rows.map((r) => toPost(r, now));
}

// What needs a person now: scheduled posts whose time has come with a manual
// channel still to post, and any channel that failed. Oldest first.
export async function listNeedsAction(): Promise<Post[]> {
  const sql = db();
  const now = new Date();
  const rows = await sql`
    ${POST_SELECT(sql)}
    WHERE p.status = 'scheduled' AND EXISTS (
      SELECT 1 FROM sales.social_post_channel c
      WHERE c.post_id = p.id
        AND (c.status = 'failed'
             OR (c.status = 'pending' AND c.channel <> 'facebook'
                 AND p.scheduled_at <= now())))
    ORDER BY p.scheduled_at
    LIMIT 100`;
  return rows.map((r) => toPost(r, now));
}

export async function getPost(id: string): Promise<Post | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [r] = await sql`${POST_SELECT(sql)} WHERE p.id = ${id}`;
  return r ? toPost(r, new Date()) : null;
}

export async function createPost(
  actor: Actor,
  scheduledAt: Date | null = null,
): Promise<string> {
  await guard(actor, "create post");
  return withTransaction(async () => {
    const [r] = await db()`
      INSERT INTO sales.social_post (created_by, scheduled_at)
      VALUES (${actor.id}, ${scheduledAt})
      RETURNING id`;
    await writeAudit({
      userId: actor.id,
      action: "create",
      entity: "social_post",
      entityId: r.id,
      before: null,
      after: null,
    });
    return r.id as string;
  });
}

export type PostInput = {
  id: string;
  body: string;
  link: string;
  mediaIds: string[];
  channels: string[];
  scheduledAt: Date | null;
  // draft: saved, nothing goes out. schedule: goes out at scheduledAt.
  intent: "draft" | "schedule";
};

function checkInput(input: PostInput, now: Date) {
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (body.length > MAX_BODY)
    throw new SocialError("invalid", "text_too_long");
  const link = input.link.trim() || null;
  if (link) {
    let ok = false;
    try {
      ok = ["https:", "http:"].includes(new URL(link).protocol);
    } catch {
      ok = false;
    }
    if (!ok || link.length > 2000)
      throw new SocialError("invalid", "bad_link");
  }
  const mediaIds = [...new Set(input.mediaIds)];
  if (!mediaIds.every(isUuid))
    throw new SocialError("invalid", "unknown_image");
  if (mediaIds.length > MAX_IMAGES)
    throw new SocialError("invalid", "too_many_images");
  const channels = [...new Set(input.channels)];
  if (!channels.every(isChannel))
    throw new SocialError("invalid", "unknown_channel");
  if (input.intent === "schedule") {
    if (channels.length === 0)
      throw new SocialError("invalid", "pick_channel");
    if (!body && mediaIds.length === 0 && !link)
      throw new SocialError("invalid", "empty_post");
    if (!input.scheduledAt)
      throw new SocialError("invalid", "pick_time");
    if (input.scheduledAt.getTime() < now.getTime() - 60_000)
      throw new SocialError("invalid", "time_passed");
  }
  return { body, link, mediaIds, channels: channels as Channel[] };
}

// Saves the post and its channels. Only while nothing of it has gone out.
export async function savePost(
  actor: Actor,
  input: PostInput,
  now: Date = new Date(),
): Promise<void> {
  await guard(actor, "save post");
  const v = checkInput(input, now);
  await withTransaction(async () => {
    const sql = db();
    const [p] = await sql`
      SELECT id FROM sales.social_post WHERE id = ${input.id} FOR UPDATE`;
    if (!p) throw new SocialError("not_found", "That post is gone.");
    const current = await sql`
      SELECT channel, status FROM sales.social_post_channel
      WHERE post_id = ${input.id}`;
    if (!isEditable(current as unknown as ChannelState[]))
      throw new SocialError(
        "locked",
        "Part of this post has already gone out, so it can't be changed.",
      );
    if (v.mediaIds.length) {
      const [{ n }] = await sql`
        SELECT count(*)::int AS n FROM sales.social_media
        WHERE id = ANY(${v.mediaIds}::uuid[])`;
      if (n !== v.mediaIds.length)
        throw new SocialError("invalid", "unknown_image");
    }
    await sql`
      UPDATE sales.social_post
      SET body = ${v.body}, link = ${v.link}, media_ids = ${v.mediaIds}::uuid[],
          scheduled_at = ${input.scheduledAt},
          status = ${input.intent === "schedule" ? "scheduled" : "draft"},
          updated_at = now()
      WHERE id = ${input.id}`;
    await sql`
      DELETE FROM sales.social_post_channel
      WHERE post_id = ${input.id} AND NOT (channel = ANY(${v.channels}::text[]))`;
    if (v.channels.length)
      await sql`
        INSERT INTO sales.social_post_channel (post_id, channel)
        SELECT ${input.id}, unnest(${v.channels}::text[])
        ON CONFLICT DO NOTHING`;
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "social_post",
      entityId: input.id,
      before: null,
      after: {
        status: input.intent === "schedule" ? "scheduled" : "draft",
        channels: v.channels,
        scheduledAt: input.scheduledAt,
      },
    });
  });
}

// Deletes a post nothing of which has gone out.
export async function deletePost(actor: Actor, id: string): Promise<void> {
  await guard(actor, "delete post");
  if (!isUuid(id)) throw new SocialError("not_found", "That post is gone.");
  await withTransaction(async () => {
    const sql = db();
    const [p] = await sql`
      SELECT id FROM sales.social_post WHERE id = ${id} FOR UPDATE`;
    if (!p) throw new SocialError("not_found", "That post is gone.");
    const [{ out }] = await sql`
      SELECT count(*)::int AS out FROM sales.social_post_channel
      WHERE post_id = ${id} AND status <> 'pending'`;
    if (out > 0)
      throw new SocialError(
        "locked",
        "Part of this post has already gone out, so it can't be deleted.",
      );
    await sql`DELETE FROM sales.social_post WHERE id = ${id}`;
    await writeAudit({
      userId: actor.id,
      action: "delete",
      entity: "social_post",
      entityId: id,
      before: null,
      after: null,
    });
  });
}

// A person posted it on a channel by hand (or posted a failed Facebook post
// by hand). Only once the post is scheduled.
export async function markPosted(
  actor: Actor,
  id: string,
  channel: string,
  externalUrl: string,
): Promise<void> {
  await guard(actor, "mark post posted");
  if (!isUuid(id) || !isChannel(channel))
    throw new SocialError("not_found", "That post is gone.");
  const url = externalUrl.trim() || null;
  if (url && (!/^https?:\/\/\S+$/.test(url) || url.length > 2000))
    throw new SocialError("invalid", "bad_link");
  await withTransaction(async () => {
    const [r] = await db()`
      UPDATE sales.social_post_channel c
      SET status = 'posted', posted_at = now(), posted_by = ${actor.id},
          external_url = ${url}, error = NULL
      FROM sales.social_post p
      WHERE c.post_id = ${id} AND c.channel = ${channel}
        AND p.id = c.post_id AND p.status = 'scheduled'
        AND c.status IN ('pending', 'failed')
      RETURNING c.post_id`;
    if (!r)
      throw new SocialError("invalid", "cant_mark");
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "social_post",
      entityId: id,
      before: null,
      after: { channel, status: "posted", by: "hand" },
    });
  });
}

// A post more than this late is not published by the job on its own: what
// it says ("class starts tomorrow") may no longer be true.
const LATE_LIMIT_MS = 12 * 60 * 60 * 1000;

// Sends a failed Facebook post back to the job. A post whose time is long
// past is moved to now, so the job's lateness check lets it through: the
// person pressing Retry has decided it should still go out.
export async function retryChannel(
  actor: Actor,
  id: string,
  channel: string,
): Promise<void> {
  await guard(actor, "retry post");
  if (!isUuid(id) || !isChannel(channel) || !isAuto(channel))
    throw new SocialError("not_found", "That post is gone.");
  await withTransaction(async () => {
    const sql = db();
    const [r] = await sql`
      UPDATE sales.social_post_channel
      SET status = 'pending', attempts = 0, error = NULL, started_at = NULL
      WHERE post_id = ${id} AND channel = ${channel} AND status = 'failed'
      RETURNING post_id`;
    if (!r) throw new SocialError("invalid", "retry_failed_only");
    await sql`
      UPDATE sales.social_post SET scheduled_at = now(), updated_at = now()
      WHERE id = ${id}
        AND scheduled_at < now() - ${`${LATE_LIMIT_MS / 1000} seconds`}::interval`;
    await writeAudit({
      userId: actor.id,
      action: "update",
      entity: "social_post",
      entityId: id,
      before: { channel, status: "failed" },
      after: { channel, status: "pending" },
    });
  });
}

// ---- The posting job --------------------------------------------------------

const MAX_ATTEMPTS = 3;
// A row still "publishing" after this was cut off mid-post (the job crashed
// or timed out). It may already be live, so it is failed, not retried.
const STUCK_AFTER = "15 minutes";

export async function processSocialQueue(
  cfg: FacebookConfig,
  maxPosts = 10,
): Promise<{
  posted: number;
  failed: number;
  retrying: number;
  stuck: number;
  late: number;
}> {
  const sql = db();
  const out = { posted: 0, failed: 0, retrying: 0, stuck: 0, late: 0 };

  const stuck = await sql`
    UPDATE sales.social_post_channel
    SET status = 'failed',
        error = 'Stopped while posting. Check the Page before retrying: it may already be live.'
    WHERE channel = 'facebook' AND status = 'publishing'
      AND started_at < now() - ${STUCK_AFTER}::interval
    RETURNING post_id`;
  out.stuck = stuck.length;

  const late = await sql`
    UPDATE sales.social_post_channel c
    SET status = 'failed',
        error = 'Not posted: more than 12 hours late. Press Retry to post it now.'
    FROM sales.social_post p
    WHERE p.id = c.post_id AND c.channel = 'facebook' AND c.status = 'pending'
      AND p.status = 'scheduled'
      AND p.scheduled_at < now() - ${`${LATE_LIMIT_MS / 1000} seconds`}::interval
    RETURNING c.post_id`;
  out.late = late.length;

  for (let i = 0; i < maxPosts; i++) {
    // Claim one due post. Committed before Facebook is called, so a second
    // job running at the same time can't post it too.
    const [c] = await sql`
      UPDATE sales.social_post_channel c
      SET status = 'publishing', started_at = now(), attempts = c.attempts + 1
      WHERE (c.post_id, c.channel) = (
        SELECT c2.post_id, c2.channel
        FROM sales.social_post_channel c2
        JOIN sales.social_post p ON p.id = c2.post_id
        WHERE c2.channel = 'facebook' AND c2.status = 'pending'
          AND p.status = 'scheduled' AND p.scheduled_at <= now()
        ORDER BY p.scheduled_at
        LIMIT 1
        FOR UPDATE OF c2 SKIP LOCKED)
      RETURNING c.post_id, c.attempts`;
    if (!c) break;

    const [p] = await sql`
      SELECT p.body, p.link,
        coalesce((SELECT array_agg(m.url ORDER BY array_position(p.media_ids, m.id))
                  FROM sales.social_media m WHERE m.id = ANY(p.media_ids)),
                 '{}') AS urls
      FROM sales.social_post p WHERE p.id = ${c.post_id}`;
    const r = await publishToFacebook(cfg, {
      body: p.body,
      link: p.link,
      imageUrls: p.urls,
    });
    if (r.ok) {
      await sql`
        UPDATE sales.social_post_channel
        SET status = 'posted', posted_at = now(), error = NULL,
            external_id = ${r.id}, external_url = ${r.url}
        WHERE post_id = ${c.post_id} AND channel = 'facebook'`;
      out.posted++;
    } else if (r.retry && c.attempts < MAX_ATTEMPTS) {
      await sql`
        UPDATE sales.social_post_channel
        SET status = 'pending', error = ${r.error}
        WHERE post_id = ${c.post_id} AND channel = 'facebook'`;
      out.retrying++;
      // Facebook is struggling: stop here, the next run carries on.
      break;
    } else {
      await sql`
        UPDATE sales.social_post_channel
        SET status = 'failed', error = ${r.error}
        WHERE post_id = ${c.post_id} AND channel = 'facebook'`;
      out.failed++;
    }
  }
  return out;
}
