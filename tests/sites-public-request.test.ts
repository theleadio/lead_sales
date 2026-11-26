import assert from "node:assert/strict";
import test from "node:test";
import { serialiseTouch, touchFrom } from "../lib/crm/attribution.ts";
import { landingAndAttribution } from "../lib/sites/public-request.ts";

const stored = serialiseTouch(
  touchFrom("https://ai.thelead.io/promo?utm_source=facebook&utm_id=c1&utm_ad_id=a1", null),
);

test("ad ids from the stored touch reach the CRM when the form page has none", () => {
  const { attribution } = landingAndAttribution("/register", {
    landingUrl: "https://ai.thelead.io/register",
    referrer: "https://ai.thelead.io/promo",
    firstTouch: stored,
    lastTouch: stored,
  });
  assert.equal(attribution.utmId, "c1");
  assert.equal(attribution.utmAdId, "a1");
});

test("the form page's own ad ids win over the stored touch", () => {
  const { attribution } = landingAndAttribution("/register", {
    landingUrl: "https://ai.thelead.io/register?utm_id=c2&utm_ad_id=a2",
    referrer: null,
    lastTouch: stored,
  });
  assert.equal(attribution.utmId, "c2");
  assert.equal(attribution.utmAdId, "a2");
});
