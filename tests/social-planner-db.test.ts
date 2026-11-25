// The social planner against the database: who may use it, saving and
// scheduling, the lock once something has gone out, marking by hand, and the
// Facebook job (claim once, retry, give up, late and stuck posts). Each test
// is rolled back. Skipped without DATABASE_URL.
import { after } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import type { FacebookConfig } from "../lib/social/facebook.ts";
import {
  createPost,
  deletePost,
  getPost,
  listNeedsAction,
  markPosted,
  processSocialQueue,
  retryChannel,
  savePost,
  SocialError,
  uploadMedia,
  type Actor,
} from "../lib/social/social.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const HOUR = 60 * 60 * 1000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR);

async function marketer(): Promise<Actor> {
  return newUser("marketing");
}

async function scheduled(
  a: Actor,
  channels: string[],
  opts: { body?: string; mediaIds?: string[] } = {},
): Promise<string> {
  const id = await createPost(a);
  await savePost(a, {
    id,
    body: opts.body ?? "Hello from LEAD",
    link: "",
    mediaIds: opts.mediaIds ?? [],
    channels,
    scheduledAt: inHours(1),
    intent: "schedule",
  });
  return id;
}

// Makes a scheduled post due now (or `hoursAgo` in the past).
async function due(id: string, hoursAgo = 0) {
  await db()`
    UPDATE sales.social_post
    SET scheduled_at = now() - ${`${hoursAgo * 3600 + 1} seconds`}::interval
    WHERE id = ${id}`;
}

function fakeFacebook(answers: Response[]) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return answers.shift() ?? new Response(JSON.stringify({ id: "111_1" }));
  }) as typeof fetch;
  const cfg: FacebookConfig = { pageId: "111", token: "t", graphVersion: "v25.0", fetchImpl };
  return { calls, cfg };
}

const channelRow = async (id: string, channel = "facebook") =>
  (await db()`
    SELECT * FROM sales.social_post_channel WHERE post_id = ${id} AND channel = ${channel}`)[0];

it("only marketing, management and super_admin can use it, and a refusal is audited", async () => {
  const sales = await newUser("sales");
  await assert.rejects(createPost(sales), (e: SocialError) => e.code === "forbidden");
  const [r] = await db()`
    SELECT count(*)::int AS n FROM audit_log
    WHERE user_id = ${sales.id} AND action = 'permission_denied'`;
  assert.equal(r.n, 1);
  for (const role of ["marketing", "management", "super_admin"] as const)
    assert.ok(await createPost(await newUser(role)));
});

it("saves a draft, then schedules it with its channels", async () => {
  const a = await marketer();
  const id = await createPost(a);
  await savePost(a, {
    id,
    body: "  Draft words  ",
    link: "",
    mediaIds: [],
    channels: ["instagram"],
    scheduledAt: null,
    intent: "draft",
  });
  let p = await getPost(id);
  assert.equal(p?.status, "draft");
  assert.equal(p?.body, "Draft words");
  assert.equal(p?.state, "draft");

  const at = inHours(2);
  await savePost(a, {
    id,
    body: "Final words",
    link: "https://lead.test/x",
    mediaIds: [],
    channels: ["facebook", "linkedin"],
    scheduledAt: at,
    intent: "schedule",
  });
  p = await getPost(id);
  assert.equal(p?.status, "scheduled");
  assert.equal(p?.scheduledAt?.getTime(), at.getTime());
  assert.deepEqual(p?.channels.map((c) => c.channel), ["facebook", "linkedin"]);
  assert.equal(p?.state, "scheduled");
});

it("refuses to schedule an empty post, no channel, no time or a time in the past", async () => {
  const a = await marketer();
  const id = await createPost(a);
  const base = { id, body: "x", link: "", mediaIds: [], channels: ["facebook"], scheduledAt: inHours(1), intent: "schedule" as const };
  const reason = (r: string) => (e: SocialError) => e.code === "invalid" && e.reason === r;
  await assert.rejects(savePost(a, { ...base, body: "" }), reason("empty_post"));
  await assert.rejects(savePost(a, { ...base, channels: [] }), reason("pick_channel"));
  await assert.rejects(savePost(a, { ...base, scheduledAt: null }), reason("pick_time"));
  await assert.rejects(savePost(a, { ...base, scheduledAt: inHours(-1) }), reason("time_passed"));
  await assert.rejects(savePost(a, { ...base, channels: ["myspace"] }), reason("unknown_channel"));
  await assert.rejects(savePost(a, { ...base, link: "javascript:alert(1)" }), reason("bad_link"));
  await assert.rejects(savePost(a, { ...base, mediaIds: [crypto.randomUUID()] }), reason("unknown_image"));
});

it("library images must be JPG or PNG of at most 4 MB, and keep their order in a post", async () => {
  const a = await marketer();
  const stored: string[] = [];
  const store = async (key: string) => {
    stored.push(key);
    return `https://cdn.test/${key}`;
  };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  await assert.rejects(uploadMedia(a, { bytes: webp, name: "a.webp" }, store), (e: SocialError) => e.reason === "image_type");
  const big = new Uint8Array(4 * 1024 * 1024 + 1);
  big.set(jpg);
  await assert.rejects(uploadMedia(a, { bytes: big, name: "big.jpg" }, store), (e: SocialError) => e.reason === "image_too_big");
  const m1 = await uploadMedia(a, { bytes: png, name: "one.png" }, store);
  const m2 = await uploadMedia(a, { bytes: jpg, name: "two.jpg" }, store);
  assert.ok(stored.every((k) => k.startsWith("social/")));

  const id = await scheduled(a, ["facebook"], { mediaIds: [m2.id, m1.id] });
  const p = await getPost(id);
  assert.deepEqual(p?.media.map((m) => m.id), [m2.id, m1.id]);
});

it("once a channel has gone out, the post can't be changed or deleted", async () => {
  const a = await marketer();
  const id = await scheduled(a, ["facebook", "instagram"]);
  await due(id);
  await markPosted(a, id, "instagram", "https://instagram.test/p/1");
  await assert.rejects(
    savePost(a, { id, body: "new", link: "", mediaIds: [], channels: ["facebook"], scheduledAt: inHours(1), intent: "schedule" }),
    (e: SocialError) => e.code === "locked",
  );
  await assert.rejects(deletePost(a, id), (e: SocialError) => e.code === "locked");
  const ig = await channelRow(id, "instagram");
  assert.equal(ig.status, "posted");
  assert.equal(ig.posted_by, a.id);
  assert.equal(ig.external_url, "https://instagram.test/p/1");
});

it("a draft can't be marked posted, and an untouched post can be deleted", async () => {
  const a = await marketer();
  const id = await createPost(a);
  await savePost(a, { id, body: "x", link: "", mediaIds: [], channels: ["instagram"], scheduledAt: null, intent: "draft" });
  await assert.rejects(markPosted(a, id, "instagram", ""), (e: SocialError) => e.reason === "cant_mark");
  await deletePost(a, id);
  assert.equal(await getPost(id), null);
});

it("'Needs you' lists due manual channels, failures, and Facebook the job hasn't posted in 15 minutes", async () => {
  const a = await marketer();
  const fbOnly = await scheduled(a, ["facebook"]);
  const ig = await scheduled(a, ["instagram"]);
  const later = await scheduled(a, ["linkedin"]);
  await due(fbOnly);
  await due(ig);
  let ids = (await listNeedsAction()).map((p) => p.id);
  assert.ok(ids.includes(ig));
  assert.ok(!ids.includes(fbOnly));
  assert.ok(!ids.includes(later));
  assert.equal((await getPost(ig))?.state, "due");
  // Facebook not posted 15 minutes after its time is handed to a person,
  // who can mark it posted.
  await db()`
    UPDATE sales.social_post SET scheduled_at = now() - interval '16 minutes'
    WHERE id = ${fbOnly}`;
  ids = (await listNeedsAction()).map((p) => p.id);
  assert.ok(ids.includes(fbOnly));
  await markPosted(a, fbOnly, "facebook", "");
  assert.equal((await channelRow(fbOnly)).status, "posted");
  assert.equal((await getPost(fbOnly))?.state, "posted");
});

it("the job posts a due Facebook post once, and leaves future posts alone", async () => {
  const a = await marketer();
  const now = await scheduled(a, ["facebook", "instagram"]);
  const future = await scheduled(a, ["facebook"]);
  await due(now);
  const fb = fakeFacebook([new Response(JSON.stringify({ id: "111_42" }))]);
  const r1 = await processSocialQueue(fb.cfg);
  assert.equal(r1.posted, 1);
  assert.equal(fb.calls.length, 1);
  const row = await channelRow(now);
  assert.equal(row.status, "posted");
  assert.equal(row.external_id, "111_42");
  assert.equal(row.external_url, "https://www.facebook.com/111_42");
  assert.equal((await channelRow(now, "instagram")).status, "pending");
  assert.equal((await channelRow(future)).status, "pending");
  // A second run finds nothing to do.
  const r2 = await processSocialQueue(fb.cfg);
  assert.equal(r2.posted, 0);
  assert.equal(fb.calls.length, 1);
});

it("a passing Facebook error is retried up to three times, then fails; Retry sends it back", async () => {
  const a = await marketer();
  const id = await scheduled(a, ["facebook"]);
  await due(id);
  const busy = () => new Response(JSON.stringify({ error: { message: "busy", code: 2 } }), { status: 500 });
  const fb = fakeFacebook([busy(), busy(), busy()]);
  for (let i = 0; i < 2; i++) {
    const r = await processSocialQueue(fb.cfg);
    assert.equal(r.retrying, 1);
    assert.equal((await channelRow(id)).status, "pending");
  }
  const r = await processSocialQueue(fb.cfg);
  assert.equal(r.failed, 1);
  const row = await channelRow(id);
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 3);
  assert.match(row.error, /Facebook answered 500/);
  assert.equal((await getPost(id))?.state, "failed");

  await retryChannel(a, id, "facebook");
  assert.equal((await channelRow(id)).status, "pending");
  const ok = fakeFacebook([]);
  assert.equal((await processSocialQueue(ok.cfg)).posted, 1);
});

it("a permanent Facebook refusal fails at once", async () => {
  const a = await marketer();
  const id = await scheduled(a, ["facebook"]);
  await due(id);
  const fb = fakeFacebook([
    new Response(JSON.stringify({ error: { message: "No permission", code: 200 } }), { status: 403 }),
  ]);
  const r = await processSocialQueue(fb.cfg);
  assert.equal(r.failed, 1);
  assert.equal((await channelRow(id)).status, "failed");
});

it("a post more than 12 hours late is not posted on its own; Retry moves it to now", async () => {
  const a = await marketer();
  const id = await scheduled(a, ["facebook"]);
  await due(id, 13);
  const fb = fakeFacebook([]);
  const r = await processSocialQueue(fb.cfg);
  assert.equal(r.late, 1);
  assert.equal(fb.calls.length, 0);
  assert.equal((await channelRow(id)).status, "failed");

  await retryChannel(a, id, "facebook");
  const p = await getPost(id);
  assert.ok(p!.scheduledAt!.getTime() > Date.now() - 60_000);
  assert.equal((await processSocialQueue(fb.cfg)).posted, 1);
});

it("a post left mid-publish by a crash is failed, not posted again", async () => {
  const a = await marketer();
  const id = await scheduled(a, ["facebook"]);
  await due(id);
  await db()`
    UPDATE sales.social_post_channel
    SET status = 'publishing', started_at = now() - interval '20 minutes', attempts = 1
    WHERE post_id = ${id}`;
  const fb = fakeFacebook([]);
  const r = await processSocialQueue(fb.cfg);
  assert.equal(r.stuck, 1);
  assert.equal(fb.calls.length, 0);
  const row = await channelRow(id);
  assert.equal(row.status, "failed");
  assert.match(row.error, /may already be live/);
});
