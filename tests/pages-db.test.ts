// Landing pages (lib/pages): the block rules, who may save and publish, and
// the lead form's path into the CRM. Each database test is rolled back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { pageBySlug, savePage, setPagePublished } from "../lib/pages/admin.ts";
import { imageType, uploadPageImage } from "../lib/pages/images.ts";
import { submitPageLead } from "../lib/pages/lead.ts";
import { blocksSchema, pairs, youtubeId } from "../lib/pages/model.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newUser } from "./seed.ts";

after(closeDb);

const env = { RATE_LIMIT_SECRET: "s".repeat(32) };
const slug = () => `t-${crypto.randomUUID().slice(0, 8)}`;
const page = (s: string, blocks: unknown[] = []) => ({
  title: "AI Engineering",
  slug: s,
  description: "",
  language: "zh",
  blocks,
});
const formBlock = { kind: "form", heading: "Enquire", formName: "AIEC form" };
const lead = (s: string, over: Record<string, unknown> = {}) =>
  submitPageLead(
    {
      slug: s,
      position: 0,
      fullName: "Tan Mei Ling",
      email: `p-${crypto.randomUUID().slice(0, 8)}@example.test`,
      ...over,
    },
    {
      ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
      env,
      landingUrl: `https://sales.example/p/${s}?utm_source=fb&utm_campaign=nov&secret=x`,
      captcha: null,
    },
  );

test("blocks: only https links, YouTube videos and known kinds", () => {
  const ok = (b: unknown) => blocksSchema.safeParse([b]).success;
  assert.ok(ok({ kind: "hero", heading: "Hi", ctaHref: "#form" }));
  assert.ok(!ok({ kind: "hero", heading: "Hi", ctaHref: "javascript:x" }));
  assert.ok(!ok({ kind: "image", url: "http://x.test/a.png" }));
  assert.ok(!ok({ kind: "button", label: "Pay", href: "" }));
  assert.ok(
    !ok({ kind: "video", url: "https://evil.test/watch?v=abcdefghijk" }),
  );
  assert.ok(!ok({ kind: "script", body: "x" }));
  assert.equal(youtubeId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.deepEqual(pairs("Great | Ali\n\nNo name"), [
    ["Great", "Ali"],
    ["No name", ""],
  ]);
});

it("a page is a draft until published, and its address is unique", async () => {
  const a = await newUser("marketing");
  const s = slug();
  const id = await savePage(a, page(s, [{ kind: "text", body: "Hello" }]));
  assert.equal(await pageBySlug(s), null, "draft is not public");
  assert.equal((await pageBySlug(s, true))?.blocks.length, 1);
  await setPagePublished(a, id, true);
  assert.equal((await pageBySlug(s))?.title, "AI Engineering");
  await assert.rejects(savePage(a, page(s)), /already has that address/);
  await assert.rejects(savePage(a, page("Bad Slug")), /Lower-case/);
  await assert.rejects(
    savePage(a, page(slug(), [{ kind: "image", url: "ftp://x" }])),
    /Block 1/,
  );
});

it("support can't save or publish a page", async () => {
  const s = slug();
  await assert.rejects(savePage(await newUser("support"), page(s)), /can't/);
  const id = await savePage(await newUser("sales"), page(s));
  await assert.rejects(
    setPagePublished(await newUser("support"), id, true),
    /can't/,
  );
});

it("the form makes one CRM lead with the block's form name and the UTMs", async () => {
  const a = await newUser("marketing");
  const s = slug();
  const id = await savePage(a, page(s, [formBlock]));
  const email = `p-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const key = `page:${crypto.randomUUID()}`;

  assert.equal((await lead(s, { email })).kind, "not_found", "draft: closed");
  await setPagePublished(a, id, true);
  assert.equal((await lead(s, { email: "" })).kind, "invalid");
  assert.equal((await lead(s, { position: 3, email })).kind, "not_found");

  const send = () => lead(s, { email, idempotencyKey: key });
  assert.equal((await send()).kind, "created");
  assert.equal((await send()).kind, "created", "a repeat is accepted");

  const rows = await db()`
    SELECT t.form_name, t.utm_source, t.landing_url, p.preferred_language,
           (SELECT count(*)::int FROM deal d WHERE d.person_id = p.id) AS deals,
           (SELECT count(*)::int FROM consent c WHERE c.person_id = p.id) AS consents
    FROM touchpoint t JOIN person p ON p.id = t.person_id
    WHERE p.email = ${email}`;
  assert.equal(rows.length, 1, "the repeat made no second touchpoint");
  assert.equal(rows[0].form_name, "AIEC form");
  assert.equal(rows[0].utm_source, "fb");
  assert.ok(!rows[0].landing_url.includes("secret"));
  assert.equal(rows[0].preferred_language, "zh");
  assert.equal(rows[0].deals, 1);
  assert.equal(rows[0].consents, 0, "no tick, no consent");
});

it("a ticked box records marketing consent; a fourth try in an hour is refused", async () => {
  const a = await newUser("marketing");
  const s = slug();
  await setPagePublished(a, await savePage(a, page(s, [formBlock])), true);
  const email = `p-${crypto.randomUUID().slice(0, 8)}@example.test`;
  assert.equal(
    (await lead(s, { email, consentMarketing: true })).kind,
    "created",
  );
  const [c] = await db()`
    SELECT count(*)::int AS n FROM consent c JOIN person p ON p.id = c.person_id
    WHERE p.email = ${email} AND c.is_granted`;
  assert.equal(c.n, 2, "email and WhatsApp marketing");
  await lead(s, { email });
  await lead(s, { email });
  assert.equal((await lead(s, { email })).kind, "rate_limited");
});

it("an upload must be a real image, from someone who may edit pages", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const saved: string[] = [];
  const store = async (key: string, _b: Uint8Array, mime: string) => {
    saved.push(`${key} ${mime}`);
    return `https://files.example/${key}`;
  };
  const a = await newUser("marketing");
  const url = await uploadPageImage(a, png, store);
  assert.ok(
    url.startsWith("https://files.example/pages/") && url.endsWith(".png"),
  );
  assert.ok(saved[0].endsWith(".png image/png"));
  // An SVG or HTML file named .png is still refused: the bytes decide.
  const svg = new TextEncoder().encode("<svg onload=alert(1)>");
  assert.equal(imageType(svg), null);
  await assert.rejects(uploadPageImage(a, svg, store), /PNG, JPEG/);
  await assert.rejects(
    uploadPageImage(a, new Uint8Array(4 * 1024 * 1024 + 1), store),
    /4 MB/,
  );
  await assert.rejects(
    uploadPageImage(await newUser("support"), png, store),
    /can't/,
  );
  assert.equal(saved.length, 1, "nothing refused was stored");
});
