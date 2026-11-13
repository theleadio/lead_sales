import test from "node:test";
import assert from "node:assert/strict";
import { routeFor } from "../lib/sites/host.ts";

test("public host rewrites everything except the static and site API paths", () => {
  assert.deepEqual(routeFor("ai.thelead.io", "/"), { action: "rewrite", to: "/site-render" });
  assert.deepEqual(routeFor("ai.thelead.io", "/workshop"), { action: "rewrite", to: "/site-render/workshop" });
  assert.deepEqual(routeFor("ai.thelead.io:443", "/automations"), { action: "rewrite", to: "/site-render/automations" });
  assert.deepEqual(routeFor("site.localhost:3000", "/x"), { action: "rewrite", to: "/site-render/x" });
  for (const p of ["/api/site/lead", "/site/runtime.js", "/_next/static/a.js"]) {
    assert.deepEqual(routeFor("ai.thelead.io", p), { action: "pass" });
  }
});

test("direct /site-render is 404 on both hosts", () => {
  assert.equal(routeFor("app.example.com", "/site-render/x").action, "notfound");
  assert.equal(routeFor("ai.thelead.io", "/site-render").action, "notfound");
  for (const p of ["/site%2Drender/x", "/SITE-RENDER/x", "/Site%2drender", "//site-render/x", "/%zz"]) {
    assert.equal(routeFor("app.example.com", p).action, "notfound", p);
  }
});

test("app host keeps the session refresh and sign-in redirect path", () => {
  assert.deepEqual(routeFor("sales.example.com", "/home"), { action: "app" });
  assert.deepEqual(routeFor("sales.example.com", "/automations"), { action: "app" }); // signed-out visitor: proxy then redirects to /sign-in
  assert.deepEqual(routeFor("localhost:3000", "/sites/preview/abc"), { action: "app" });
});
