import test from "node:test";
import assert from "node:assert/strict";
import { checkImage, ImageError, imageType, MAX_IMAGE_BYTES, svgIsSafe } from "../lib/sites/images.ts";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);

test("type is told by the first bytes", () => {
  assert.equal(imageType(bytes(0x89, 0x50, 0x4e, 0x47, 1, 2))?.ext, "png");
  assert.equal(imageType(JPG)?.mime, "image/jpeg");
  assert.equal(imageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))?.ext, "webp");
  assert.equal(imageType(text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.ext, "svg");
  assert.equal(imageType(bytes(0x47, 0x49, 0x46, 0x38)), null, "gif is not accepted");
  assert.equal(imageType(text("<html><svg></svg></html>")), null);
  assert.equal(imageType(text("hello")), null);
});

test("size limit is 5 MB", () => {
  const ok = new Uint8Array(MAX_IMAGE_BYTES);
  ok.set(JPG);
  assert.doesNotThrow(() => checkImage(ok));
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(JPG);
  assert.throws(() => checkImage(big), ImageError);
});

test("an SVG with script, handlers or embeds is refused", () => {
  const svg = (inner: string, attrs = "") => text(`<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner}</svg>`);
  assert.doesNotThrow(() => checkImage(svg('<circle r="4"/>')));
  for (const bad of [
    svg("<script>alert(1)</script>"),
    svg('<circle onclick="x()"/>'),
    svg("", ' onload="x()"'),
    svg('<a href="javascript:alert(1)"><text>x</text></a>'),
    svg('<foreignObject><iframe src="https://e"></iframe></foreignObject>'),
  ])
    assert.throws(() => checkImage(bad), /SVG/);
  assert.equal(svgIsSafe('<svg><path d="M0 0"/></svg>'), true);
});
