import test from "node:test";
import assert from "node:assert/strict";
import { checkImage, ImageError, imageType, MAX_IMAGE_BYTES, sanitizeSvg } from "../lib/sites/images.ts";

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

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (inner: string, attrs = "") => text(`<svg ${NS}${attrs}>${inner}</svg>`);

test("a plain icon SVG passes and is stored as rebuilt", () => {
  const icon = `<svg ${NS} viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="#a1bace"/></linearGradient></defs><path d="M1 1h22v22H1z" fill="url(#g)" stroke="#0a0a0a" stroke-width="2"/><circle cx="12" cy="12" r="4"/><text x="1" y="2">Hi</text></svg>`;
  const r = checkImage(text(icon));
  assert.equal(r.mime, "image/svg+xml");
  const out = new TextDecoder().decode(r.bytes);
  assert.match(out, /^<svg /);
  assert.match(out, /viewBox="0 0 24 24"/);
  assert.match(out, /<linearGradient id="g">/);
  assert.ok(out.includes('fill="url(#g)"'));
  assert.match(out, /<circle cx="12" cy="12" r="4"/);
});

test("every SVG bypass is refused", () => {
  const bypasses: [string, Uint8Array][] = [
    ["script", svg("<script>alert(1)</script>")],
    ["prefixed script", text('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg:svg>')],
    ["prefixed script inside svg", svg('<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>')],
    ["prefixed foreignObject", svg('<x:foreignObject xmlns:x="http://www.w3.org/2000/svg"><iframe/></x:foreignObject>')],
    ["foreignObject", svg("<foreignObject><iframe/></foreignObject>")],
    ["handler", svg('<circle onclick="x()"/>')],
    ["onload on root", svg("", ' onload="x()"')],
    ["javascript href", svg('<a href="javascript:alert(1)"><text>x</text></a>')],
    ["entity-encoded javascript", svg('<a href="&#106;avascript:alert(1)"><text>x</text></a>')],
    ["hex-entity javascript xlink", svg('<a xlink:href="&#x6A;avascript:alert(1)"><text>x</text></a>')],
    ["external image", svg('<image href="https://evil.example/x.png"/>')],
    ["use", svg('<use href="https://evil.example/x.svg#a"/>')],
    ["style @import", svg('<style>@import url(https://evil.example/x.css);</style>')],
    ["style attribute", svg('<rect style="fill:url(https://evil.example/x)"/>')],
    ["external url() in fill", svg('<rect fill="url(https://evil.example/x)"/>')],
    ["animate", svg('<animate attributeName="href" to="javascript:alert(1)"/>')],
    ["entity declaration", text('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')],
    ["foreign xmlns", text('<svg xmlns="http://www.w3.org/1999/xhtml"><path d="M0 0"/></svg>')],
  ];
  for (const [name, b] of bypasses) assert.throws(() => checkImage(b), ImageError, name);
  assert.equal(sanitizeSvg("<svg><path d=\"M0 0\"/></svg>") !== null, true);
});
