import { test } from "node:test";
import assert from "node:assert/strict";
import { readR, writeR, resetR, isSetR, validHex, hex6, fromLines, toLines, urlError, imageUrlError, httpsOnlyError, moveItem } from "../lib/sites/editor-settings.ts";

test("responsive read falls back m -> t -> d", () => {
  assert.equal(readR({ d: 40 }, "m"), 40);
  assert.equal(readR({ d: 40, t: 30 }, "m"), 30);
  assert.equal(readR({ d: 40, t: 30, m: 20 }, "m"), 20);
  assert.equal(readR({ d: 40, m: 20 }, "t"), 40);
});
test("writing desktop keeps t/m overrides; writing a device keeps the rest", () => {
  assert.deepEqual(writeR({ d: 40, t: 30, m: 20 }, "d", 50), { d: 50, t: 30, m: 20 });
  assert.deepEqual(writeR({ d: 40 }, "m", 18), { d: 40, m: 18 });
});
test("reset removes the override only", () => {
  assert.deepEqual(resetR({ d: 40, t: 30, m: 20 }, "t"), { d: 40, m: 20 });
  assert.deepEqual(resetR({ d: 40 }, "d"), { d: 40 });
  assert.equal(isSetR({ d: 40 }, "t"), false);
  assert.equal(isSetR({ d: 40, t: 0 }, "t"), true);
});
test("hex validation", () => {
  assert.ok(validHex("#abc") && validHex("#A1B2C3"));
  assert.ok(!validHex("abc") && !validHex("#abcd") && !validHex("red") && !validHex(""));
  assert.equal(hex6("#abc"), "#aabbcc");
  assert.equal(hex6("nope"), "#111827");
});
test("list text", () => {
  assert.deepEqual(fromLines("a\n\n b \n"), ["a", "b"]);
  assert.equal(toLines(["a", "b"]), "a\nb");
});
test("url rules", () => {
  assert.equal(urlError("javascript:alert(1)") !== null, true);
  assert.equal(urlError("//evil.com") !== null, true);
  assert.equal(urlError("/x"), null);
  assert.equal(imageUrlError("mailto:a@b.c") !== null, true);
  assert.equal(imageUrlError("https://a.b/c.png"), null);
  assert.equal(httpsOnlyError("http://a.b") !== null, true);
  assert.equal(httpsOnlyError("/x") !== null, true);
  assert.equal(httpsOnlyError("https://a.b"), null);
});
test("moveItem", () => {
  assert.deepEqual(moveItem([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(moveItem([1, 2, 3], 0, -1), [1, 2, 3]);
});
