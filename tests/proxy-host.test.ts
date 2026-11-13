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
});

test("app host keeps the session refresh and sign-in redirect path", () => {
  assert.deepEqual(routeFor("sales.example.com", "/home"), { action: "app" });
  assert.deepEqual(routeFor("localhost:3000", "/sites/preview/abc"), { action: "app" });
});
