import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  TOUCH_MAX_AGE_DAYS,
  attributionPayload,
  hasCampaign,
  nextTouches,
  parseTouch,
  serialiseTouch,
  touchCookie,
  touchFrom,
} from "../lib/crm/attribution.ts";

// Cases copied from lead_crm tests/public-lead-form.test.ts (§10.2 attribution
// rules). Keep in step with that file. The trimUrl-vs-cleanUrl parity test
// stays in lead_crm: cleanUrl needs its database module.
// §10.2. The attribution rules. The cookie-writing component and the server
// action are covered further down; these first tests are the rules alone.

test("a campaign arrival keeps every field the link carried", () => {
  const t = touchFrom(
    "https://lead.test/schedule?utm_source=fb&utm_medium=cpc" +
      "&utm_campaign=agentic_202610_leads_en&utm_content=hero&utm_term=ai" +
      "&gclid=abc&fbclid=def",
    "https://www.facebook.com/",
    new Date("2026-10-21T02:00:00.000Z"),
  );
  assert.equal(t.utmSource, "fb");
  assert.equal(t.utmMedium, "cpc");
  assert.equal(t.utmCampaign, "agentic_202610_leads_en");
  assert.equal(t.utmContent, "hero");
  assert.equal(t.utmTerm, "ai");
  assert.equal(t.gclid, "abc");
  assert.equal(t.fbclid, "def");
  assert.equal(t.referrer, "https://www.facebook.com/");
  assert.equal(t.occurredAt, "2026-10-21T02:00:00.000Z");
});

test("the O61 click ids are read from the link", () => {
  const t = touchFrom(
    "https://lead.test/schedule?gbraid=gb&wbraid=wb&li_fat_id=li&ttclid=tt",
    null,
  );
  assert.equal(t.gbraid, "gb");
  assert.equal(t.wbraid, "wb");
  assert.equal(t.liFatId, "li");
  assert.equal(t.ttclid, "tt");
  assert.equal(
    t.landingUrl,
    "https://lead.test/schedule?gbraid=gb&wbraid=wb&li_fat_id=li&ttclid=tt",
  );
  assert.deepEqual(parseTouch(serialiseTouch(t)), t);
  const payload = attributionPayload(null, t)!;
  assert.equal(payload.gbraid, "gb");
  assert.equal(payload.liFatId, "li");
});

test("a bare arrival is still recorded, so it is not mistaken for a campaign later", () => {
  const t = touchFrom("https://lead.test/schedule", null);
  assert.equal(t.utmSource, null);
  assert.equal(t.gclid, null);
  assert.equal(t.referrer, null);
  // §10.2's scenario "Arriving with nothing": the landing URL and the time
  // are what make the visit a record rather than an absence.
  assert.equal(t.landingUrl, "https://lead.test/schedule");
  assert.ok(Date.parse(t.occurredAt) > 0);
});

test("a landing URL drops query parameters that are not campaign ones", () => {
  const t = touchFrom(
    "https://lead.test/schedule?utm_source=fb&session=secret&ref=xyz#top",
    null,
  );
  assert.equal(t.landingUrl, "https://lead.test/schedule?utm_source=fb");
});

test("a touch survives a round trip through a cookie value", () => {
  const t = touchFrom(
    "https://lead.test/enquiry?utm_source=fb",
    "https://x.test/",
  );
  assert.deepEqual(parseTouch(serialiseTouch(t)), t);
});

test("an unreadable cookie value reads as absent rather than throwing", () => {
  for (const raw of ["", "not json", "%%%", "null", "[]", '{"a":1}'])
    assert.equal(parseTouch(raw), null, `should be null for ${raw}`);
});

// The browser hands back what `document.cookie` holds, percent-encoded;
// Next's `cookies()` decodes once before the action sees it. A second decode
// corrupted a campaign carrying its own `%` and threw on a bare one, so the
// touch was lost on the server and nowhere else.
test("a cookie read decodes once, whichever side is reading it", () => {
  for (const campaign of ["raya%50off", "50% off", "mastery_202611"]) {
    const t = {
      ...touchFrom("https://lead.test/enquiry", null),
      utmCampaign: campaign,
    };
    const cookie = serialiseTouch(t);
    // The browser: document.cookie gives back exactly what was written.
    assert.deepEqual(parseTouch(cookie), t, `browser read of ${campaign}`);
    // The server: Next has already decoded it once.
    assert.deepEqual(
      parseTouch(decodeURIComponent(cookie)),
      t,
      `server read of ${campaign}`,
    );
  }
});

test("the attribution cookie carries §10.2's lifetime and nothing looser", () => {
  const plain = touchCookie(FIRST_TOUCH_COOKIE, "abc", false);
  assert.equal(
    plain,
    "lead_first_touch=abc; Path=/; Max-Age=7776000; SameSite=Lax",
  );
  // §10.2's 90 days, spelled in seconds so a change to either is caught.
  assert.equal(TOUCH_MAX_AGE_DAYS * 86400, 7776000);

  // Secure wherever the page is https, and never on the plain http dev
  // server, where the browser would drop the cookie outright.
  assert.match(touchCookie(LAST_TOUCH_COOKIE, "x", true), /; Secure$/);
  assert.doesNotMatch(plain, /Secure/);

  // SameSite=Lax and no Domain: the cookie rides a top-level arrival from an
  // ad or an email, never a cross-site subrequest, and never widens to a
  // parent domain.
  assert.doesNotMatch(plain, /SameSite=None|Domain=/i);
});
test("a tampered cookie costs attribution, not the lead", () => {
  const t = parseTouch(
    encodeURIComponent(
      JSON.stringify({
        occurredAt: "2026-10-22T02:00:00.000Z",
        utmSource: 7,
        utmCampaign: "x".repeat(400),
        fbclid: "f".repeat(900),
        landingUrl: "javascript:alert(1)",
        referrer: null,
      }),
    ),
  );
  assert.ok(t);
  assert.equal(t.utmSource, null, "a non-string field reads as absent");
  assert.equal(t.utmCampaign?.length, 200);
  assert.equal(t.fbclid?.length, 500);
  assert.equal(t.landingUrl, null, "a non-http URL reads as absent");
  const payload = attributionPayload(null, t);
  for (const [k, v] of Object.entries(payload!))
    if (k !== "firstTouch")
      assert.ok(
        v === null || typeof v === "string",
        `${k} must be a string or null`,
      );
});

// §10.2 calls overwriting the first touch the mistake that breaks all
// attribution reporting, so it gets its own test before it is wired up.

test("an existing first touch is kept when a later arrival carries a different campaign", () => {
  const first = touchFrom(
    "https://lead.test/schedule?utm_campaign=agentic_202610_leads_en&utm_source=fb",
    null,
    new Date("2026-10-01T00:00:00.000Z"),
  );
  const { first: toWrite, last } = nextTouches(
    serialiseTouch(first),
    "https://lead.test/schedule?utm_campaign=mastery_202611&utm_source=google",
    null,
  );
  // null means "leave the stored one alone" — rewriting it would also roll
  // its 90 days forward, which is not the 90 days §10.2 asks for.
  assert.equal(toWrite, null);
  assert.equal(last?.utmCampaign, "mastery_202611");
  assert.equal(last?.utmSource, "google");
});

test("a direct return with no campaign at all does not erase the first touch", () => {
  const first = touchFrom("https://lead.test/?utm_source=fb", null);
  const { first: toWrite } = nextTouches(
    serialiseTouch(first),
    "https://lead.test/schedule",
    null,
  );
  assert.equal(toWrite, null);
});

test("a missing first touch is created", () => {
  const { first, last } = nextTouches(
    null,
    "https://lead.test/schedule?utm_source=fb",
    null,
  );
  assert.ok(first);
  assert.equal(first.utmSource, "fb");
  assert.equal(last?.utmSource, "fb");
});

test("an unreadable first touch is replaced rather than kept", () => {
  const { first } = nextTouches("not json", "https://lead.test/", null);
  assert.ok(first, "a value we cannot read is no value");
});

test("the submission carries the first campaign and the latest one together", () => {
  const first = touchFrom(
    "https://lead.test/?utm_source=fb&utm_campaign=agentic_202610_leads_en",
    null,
    new Date("2026-10-01T00:00:00.000Z"),
  );
  const last = touchFrom(
    "https://lead.test/enquiry?utm_source=google&utm_campaign=mastery_202611",
    null,
  );
  const a = attributionPayload(first, last) as Record<string, unknown>;
  assert.equal(a.utmCampaign, "mastery_202611");
  const ft = a.firstTouch as Record<string, unknown>;
  assert.equal(ft.utmCampaign, "agentic_202610_leads_en");
  assert.equal(ft.occurredAt, "2026-10-01T00:00:00.000Z");
});

test("attribution is null when nothing was ever recorded", () => {
  assert.equal(attributionPayload(null, null), null);
});

test("a campaign-less move within the site does not erase the last touch", () => {
  const campaign = touchFrom(
    "https://lead.test/schedule?utm_source=fb&utm_campaign=test",
    "https://www.facebook.com/",
  );
  const { last } = nextTouches(
    serialiseTouch(campaign),
    "https://lead.test/enquiry?class=AIA-2611-EN",
    "https://lead.test/schedule?utm_source=fb&utm_campaign=test",
    new Date(),
    serialiseTouch(campaign),
  );
  assert.equal(last, null, "null leaves the stored last touch alone");
});

test("a campaign on a later page still refreshes the last touch", () => {
  const stored = touchFrom("https://lead.test/?utm_source=fb", null);
  const { last } = nextTouches(
    serialiseTouch(stored),
    "https://lead.test/enquiry?utm_source=google&utm_campaign=mastery_202611",
    "https://lead.test/schedule",
    new Date(),
    serialiseTouch(stored),
  );
  assert.equal(last?.utmSource, "google");
});

test("a fresh arrival from outside refreshes the last touch even with no campaign", () => {
  const stored = touchFrom("https://lead.test/?utm_source=fb", null);
  const { last } = nextTouches(
    serialiseTouch(stored),
    "https://lead.test/schedule",
    "https://www.google.com/",
    new Date(),
    serialiseTouch(stored),
  );
  assert.ok(last, "arriving from elsewhere is a new touch");
  assert.equal(last.referrer, "https://www.google.com/");
});

test("a first visit writes both, with nothing stored", () => {
  const { first, last } = nextTouches(null, "https://lead.test/", null);
  assert.ok(first);
  assert.ok(last);
});

test("hasCampaign is what tells an arrival from a navigation", () => {
  assert.equal(hasCampaign(touchFrom("https://lead.test/x", null)), false);
  assert.equal(
    hasCampaign(touchFrom("https://lead.test/x?gclid=1", null)),
    true,
  );
  assert.equal(
    hasCampaign(touchFrom("https://lead.test/x?utm_term=ai", null)),
    true,
  );
  // A Google ad tapped inside an iOS app reaches the site with wbraid and
  // no gclid or utm.
  assert.equal(
    hasCampaign(touchFrom("https://lead.test/x?wbraid=1", null)),
    true,
  );
});

