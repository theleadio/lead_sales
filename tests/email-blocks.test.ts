// The email block editor's pure parts: what each block turns into, that
// nothing a person types can become HTML, and that the sanitiser keeps what
// the blocks write (so the sent email looks like the preview).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockProblem,
  blocksSchema,
  inlineMarkup,
  newBlock,
  renderBlocks,
  STARTER_BLOCKS,
  type Block,
} from "../lib/email/blocks.ts";
import { cleanBody, renderCampaign } from "../lib/email/campaign.ts";

const all: Block[] = [
  { id: "a", type: "heading", text: "December classes", align: "center" },
  {
    id: "b",
    type: "text",
    text: "Hi {{name}},\n\nSeats are **limited**. See [the dates](https://ai.thelead.io/dates).",
    align: "left",
  },
  {
    id: "c",
    type: "image",
    url: "https://cdn.example.com/poster.png",
    alt: "Poster",
    href: "https://ai.thelead.io",
  },
  {
    id: "d",
    type: "button",
    label: "Register now",
    href: "https://ai.thelead.io/register",
    align: "center",
    color: "yellow",
  },
  { id: "e", type: "divider" },
];

test("each block becomes the email HTML it should", () => {
  const html = renderBlocks(all);
  assert.match(
    html,
    /<h2 style="text-align:center;[^"]*">December classes<\/h2>/,
  );
  // Blank lines make paragraphs; marks become bold and a link.
  assert.match(html, /<p [^>]*>Hi \{\{name\}\},<\/p><p /);
  assert.match(html, /<strong>limited<\/strong>/);
  assert.match(
    html,
    /<a href="https:\/\/ai.thelead.io\/dates"[^>]*>the dates<\/a>/,
  );
  assert.match(
    html,
    /<a href="https:\/\/ai.thelead.io"><img src="https:\/\/cdn.example.com\/poster.png" alt="Poster"/,
  );
  assert.match(
    html,
    /background-color:#fbe33b;color:#0a0a0a;[^"]*">Register now<\/a>/,
  );
  assert.match(html, /<hr /);
});

test("the sanitiser keeps every style the blocks use", () => {
  const html = renderBlocks(all);
  const clean = cleanBody(html);
  for (const s of [
    "text-align:center",
    "font-size:24px",
    "padding:12px 22px",
    "border-radius:8px",
    "display:inline-block",
    "background-color:#fbe33b",
    "text-decoration:none",
    "font-weight:600",
    "max-width:100%",
    "border-top:1px solid #e5e5ea",
  ])
    assert.ok(clean.includes(s), `kept ${s}`);
});

test("typed text can't become HTML", () => {
  const html = renderBlocks([
    {
      id: "x",
      type: "text",
      text: '<script>alert(1)</script> **<b>x</b>** [click](javascript:alert(1)) "q"',
      align: "left",
    },
    {
      id: "y",
      type: "heading",
      text: "<img src=x onerror=alert(1)>",
      align: "left",
    },
  ]);
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&quot;q&quot;"));
});

test("inline marks: only https and mailto links", () => {
  assert.equal(
    inlineMarkup("[a](http://x.com) [b](mailto:hi@lead.io)"),
    '[a](http://x.com) <a href="mailto:hi@lead.io" style="color:#2c5674">b</a>',
  );
});

test("the schema refuses unsafe or unfinished blocks", () => {
  const bad = (b: unknown) => !blocksSchema.safeParse([b]).success;
  assert.ok(
    bad({
      id: "1",
      type: "button",
      label: "Go",
      href: "javascript:alert(1)",
      align: "left",
      color: "blue",
    }),
  );
  assert.ok(
    bad({
      id: "1",
      type: "button",
      label: "Go",
      href: "https://",
      align: "left",
      color: "blue",
    }),
  );
  assert.ok(
    bad({
      id: "1",
      type: "button",
      label: " ",
      href: "https://a.io",
      align: "left",
      color: "blue",
    }),
  );
  assert.ok(
    bad({
      id: "1",
      type: "image",
      url: "http://a.io/x.png",
      alt: "",
      href: "",
    }),
  );
  assert.ok(
    bad({
      id: "1",
      type: "image",
      url: 'https://a.io/"onerror',
      alt: "",
      href: "",
    }),
  );
  assert.ok(bad({ id: "1", type: "script" }));
  assert.ok(blocksSchema.safeParse(all).success);
  assert.ok(
    !blocksSchema.safeParse(
      Array.from({ length: 101 }, () => newBlock("divider")),
    ).success,
  );
});

test("a new image with no address renders nothing; the starter blocks are valid", () => {
  assert.equal(renderBlocks([newBlock("image")]), "");
  assert.ok(blocksSchema.safeParse(STARTER_BLOCKS()).success);
  assert.match(blockProblem(newBlock("image")) ?? "", /Choose an image/);
});

test("the sent email carries the button's link in its text version", () => {
  const m = renderCampaign({
    bodyHtml: renderBlocks(all),
    name: "Aisyah",
    language: "en",
    unsubscribeUrl: "https://sales.lead.io/api/email/unsubscribe?t=x",
  });
  assert.match(m.html, /Hi Aisyah,/);
  assert.match(m.text, /Register now \(https:\/\/ai.thelead.io\/register\)/);
  assert.match(m.text, /Unsubscribe: https:\/\/sales.lead.io/);
});
