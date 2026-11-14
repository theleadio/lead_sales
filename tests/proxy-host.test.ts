import test from "node:test";
import assert from "node:assert/strict";
import { routeFor } from "../lib/sites/host.ts";

test("public host rewrites everything except the static and site API paths", () => {
  assert.deepEqual(routeFor("ai.thelead.io", "/"), { action: "rewrite", to: "/site-render" });
  assert.deepEqual(routeFor("ai.thelead.io", "/workshop"), { action: "rewrite", to: "/site-render/workshop" });
  assert.deepEqual(routeFor("ai.thelead.io:443", "/automations"), { action: "rewrite", to: "/site-render/automations" });
  assert.deepEqual(routeFor("site.localhost:3000", "/x"), { action: "rewrite", to: "/site-render/x" });
  for (const p of ["/api/site/form", "/api/site/checkout", "/api/site/view", "/api/site/class/AI-2026-12", "/site/runtime.js", "/site/runtime.css", "/_next/static/a.js"]) {
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

test("traversal and unlisted site paths never reach the app or an upload route", () => {
  for (const p of ["/site/../automations", "/site/%2e%2e/automations", "/api/site/../../automations", "/site\\x", "/a%2fb", "/a%5Cb", "/x%00", "/%2e%2e/x"]) {
    assert.equal(routeFor("ai.thelead.io", p).action, "notfound", p);
  }
  // image upload and other /api/site paths are not reachable on the public host
  for (const p of ["/api/site/image", "/api/site/lead", "/site/other.js"]) {
    assert.deepEqual(routeFor("ai.thelead.io", p), { action: "rewrite", to: `/site-render${p}` }, p);
  }
});
