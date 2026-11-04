// The brand decision of 4 Nov, as numbers: logo blue and yellow are fills
// with dark text, never white text, and primary buttons pass WCAG AA (4.5:1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

async function tokens(): Promise<Record<string, string>> {
  const css = await readFile(
    join(import.meta.dirname, "..", "app", "globals.css"),
    "utf8",
  );
  return Object.fromEntries(
    [...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}

test("logo colours are the ones decided on 4 Nov", async () => {
  const t = await tokens();
  assert.equal(t["lead-blue"], "#a1bace");
  assert.equal(t["lead-yellow"], "#fbe33b");
});

test("dark text on the logo colours passes AA; white text would not", async () => {
  const t = await tokens();
  for (const fill of [t["lead-blue"], t["lead-yellow"]]) {
    assert.ok(contrast(t.ink, fill) >= 4.5);
    assert.ok(contrast("#ffffff", fill) < 4.5);
  }
});

test("primary buttons and body text pass AA", async () => {
  const t = await tokens();
  assert.ok(contrast(t["action-ink"], t.action) >= 4.5);
  assert.ok(contrast(t.ink, t.surface) >= 4.5);
  assert.ok(contrast(t["ink-muted"], t["surface-muted"]) >= 4.5);
});
