// The social planner's pure parts: Malaysia time, the calendar grid, a
// post's state, and the Facebook Graph calls (with a fake fetch).
import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  dayStart,
  isDay,
  monthGrid,
  mytDay,
  mytTime,
  parseMyt,
  postState,
  postText,
  toMytInput,
  weekStart,
  isReason,
} from "../lib/social/planner.ts";
import {
  facebookConfigFromEnv,
  publishToFacebook,
  type FacebookConfig,
} from "../lib/social/facebook.ts";

test("Malaysia time round-trips through a datetime-local value", () => {
  const d = parseMyt("2026-11-25T14:30");
  assert.equal(d?.toISOString(), "2026-11-25T06:30:00.000Z");
  assert.equal(toMytInput(d!), "2026-11-25T14:30");
  assert.equal(mytTime(d!), "14:30");
  // 07:00 in Malaysia is still the previous day in UTC.
  const early = parseMyt("2026-11-25T07:00")!;
  assert.equal(early.toISOString().slice(0, 10), "2026-11-24");
  assert.equal(mytDay(early), "2026-11-25");
  assert.equal(dayStart("2026-11-25").toISOString(), "2026-11-24T16:00:00.000Z");
});

test("impossible dates and times are refused, not moved", () => {
  for (const v of ["2026-02-31T10:00", "2026-13-01T10:00", "2026-11-25T24:00", "2026-11-25", "x", ""])
    assert.equal(parseMyt(v), null, v);
  assert.equal(isDay("2026-02-29"), false);
  assert.equal(isDay("2028-02-29"), true);
  assert.equal(isDay(undefined), false);
});

test("calendar weeks start on Monday and cover the whole month", () => {
  assert.equal(weekStart("2026-11-25"), "2026-11-23"); // a Wednesday
  assert.equal(weekStart("2026-11-23"), "2026-11-23"); // a Monday
  assert.equal(weekStart("2026-11-29"), "2026-11-23"); // a Sunday
  const g = monthGrid("2026-11-25");
  assert.equal(g[0][0], "2026-10-26");
  assert.ok(g.flat().includes("2026-11-01") && g.flat().includes("2026-11-30"));
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-01");
  assert.equal(addMonths("2026-01-31", -1), "2025-12-01");
});

test("a post's state comes from its channels", () => {
  const past = new Date("2026-11-25T00:00:00Z");
  const now = new Date("2026-11-25T01:00:00Z");
  const future = new Date("2026-11-26T00:00:00Z");
  const s = (status: "draft" | "scheduled", at: Date | null, ch: [string, string][]) =>
    postState(
      { status, scheduledAt: at },
      ch.map(([channel, st]) => ({ channel, status: st }) as never),
      now,
    );
  assert.equal(s("draft", past, [["facebook", "pending"]]), "draft");
  assert.equal(s("scheduled", future, [["facebook", "pending"], ["instagram", "pending"]]), "scheduled");
  // Facebook alone, time just reached: the job will post it, nobody acts yet.
  const justNow = new Date(now.getTime() - 5 * 60 * 1000);
  assert.equal(s("scheduled", justNow, [["facebook", "pending"]]), "scheduled");
  // Still not posted 15 minutes on (not set up, or the job is behind): a
  // person posts it by hand.
  assert.equal(s("scheduled", past, [["facebook", "pending"]]), "due");
  assert.equal(s("scheduled", past, [["facebook", "posted"], ["instagram", "pending"]]), "due");
  assert.equal(s("scheduled", past, [["facebook", "posted"], ["instagram", "posted"]]), "posted");
  assert.equal(s("scheduled", past, [["facebook", "failed"], ["instagram", "posted"]]), "failed");
  assert.equal(s("scheduled", past, [["facebook", "publishing"]]), "posting");
  assert.equal(s("scheduled", future, [["facebook", "posted"], ["instagram", "pending"]]), "partly_posted");
});

test("a link goes into the text only when asked", () => {
  assert.equal(postText(" Hello ", "https://x.test", false), "Hello");
  assert.equal(postText("Hello", "https://x.test", true), "Hello\n\nhttps://x.test");
  assert.equal(postText("", "https://x.test", true), "https://x.test");
  assert.equal(postText("Hello", null, true), "Hello");
});

test("refusal keys are a closed list", () => {
  assert.equal(isReason("time_passed"), true);
  assert.equal(isReason("<script>"), false);
  assert.equal(isReason("toString"), false);
  assert.equal(isReason(undefined), false);
});

test("Facebook config needs a numeric page id and a token", () => {
  assert.equal(facebookConfigFromEnv({}), null);
  assert.equal(facebookConfigFromEnv({ FACEBOOK_PAGE_ID: "abc", FACEBOOK_PAGE_TOKEN: "t" }), null);
  assert.deepEqual(facebookConfigFromEnv({ FACEBOOK_PAGE_ID: "123", FACEBOOK_PAGE_TOKEN: "t" }), {
    pageId: "123",
    token: "t",
    graphVersion: "v25.0",
  });
});

type Call = { url: string; body: Record<string, string> };

function fakeGraph(answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: Object.fromEntries(new URLSearchParams(init.body as URLSearchParams)),
    });
    const a = answers.shift();
    if (!a) throw new Error("no more answers");
    if (a instanceof Error) throw a;
    return a;
  }) as typeof fetch;
  const cfg: FacebookConfig = { pageId: "111", token: "EAAsecret", graphVersion: "v25.0", fetchImpl };
  return { calls, cfg };
}

const ok = (json: object) => new Response(JSON.stringify(json), { status: 200 });

test("a text post goes to /feed with its link, the token in the body", async () => {
  const { calls, cfg } = fakeGraph([ok({ id: "111_9" })]);
  const r = await publishToFacebook(cfg, { body: "Hi", link: "https://lead.test", imageUrls: [] });
  assert.deepEqual(r, { ok: true, id: "111_9", url: "https://www.facebook.com/111_9" });
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/111/feed");
  assert.deepEqual(calls[0].body, { message: "Hi", link: "https://lead.test", access_token: "EAAsecret" });
  assert.ok(!calls[0].url.includes("EAA"));
});

test("one image goes to /photos with the link in the caption", async () => {
  const { calls, cfg } = fakeGraph([ok({ id: "55", post_id: "111_56" })]);
  const r = await publishToFacebook(cfg, { body: "Hi", link: "https://lead.test", imageUrls: ["https://img.test/a.jpg"] });
  assert.deepEqual(r, { ok: true, id: "111_56", url: "https://www.facebook.com/111_56" });
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/111/photos");
  assert.equal(calls[0].body.url, "https://img.test/a.jpg");
  assert.equal(calls[0].body.caption, "Hi\n\nhttps://lead.test");
});

test("several images are uploaded unpublished, then attached to one feed post", async () => {
  const { calls, cfg } = fakeGraph([ok({ id: "1" }), ok({ id: "2" }), ok({ id: "111_3" })]);
  const r = await publishToFacebook(cfg, { body: "Hi", link: null, imageUrls: ["https://i.test/1.jpg", "https://i.test/2.png"] });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.published, "false");
  assert.equal(calls[1].body.url, "https://i.test/2.png");
  assert.equal(calls[2].url, "https://graph.facebook.com/v25.0/111/feed");
  assert.deepEqual(JSON.parse(calls[2].body.attached_media), [{ media_fbid: "1" }, { media_fbid: "2" }]);
});

test("Facebook refusals: passing ones are retried, others are not, and no token leaks", async () => {
  const bad = (status: number, error: object) => new Response(JSON.stringify({ error }), { status });
  let g = fakeGraph([bad(400, { message: "Rate limited", code: 4 })]);
  let r = await publishToFacebook(g.cfg, { body: "x", link: null, imageUrls: [] });
  assert.deepEqual(r, { ok: false, error: "Facebook answered 400 (code 4): Rate limited", retry: true });

  g = fakeGraph([bad(403, { message: "Needs pages_manage_posts for token EAAabc123", code: 200 })]);
  r = await publishToFacebook(g.cfg, { body: "x", link: null, imageUrls: [] });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.retry, false);
  assert.ok(!r.ok && !r.error.includes("EAAabc123") && r.error.includes("[token]"));

  g = fakeGraph([new TypeError("network")]);
  r = await publishToFacebook(g.cfg, { body: "x", link: null, imageUrls: [] });
  assert.deepEqual(r, { ok: false, error: "Facebook unreachable", retry: true });

  g = fakeGraph([new Response("oops", { status: 502 })]);
  r = await publishToFacebook(g.cfg, { body: "x", link: null, imageUrls: [] });
  assert.deepEqual(r, { ok: false, error: "Facebook answered 502", retry: true });
});
