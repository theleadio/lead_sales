import test from "node:test";
import assert from "node:assert/strict";
import {
  formNameFor,
  normalizePath,
  pathSchema,
  workshopFormName,
  type LeadFormSettings,
} from "../lib/sites/model.ts";
import { canEditSites, canViewSites } from "../lib/sites/permissions.ts";
import { ROLES } from "../lib/auth/roles.ts";

// Fixture: lead_crm's parseWorkshopForm regex.
const RE = /\bLEAD\s*-\s*(.+?)\s*(?:-\s*)?(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})\s*$/i;

test("workshopFormName format and round trip", () => {
  const en = workshopFormName("AI Vibe Coding Masterclass", "2026-11-18");
  assert.equal(en, "LEAD - AI Vibe Coding Masterclass 18 Nov 2026");
  assert.deepEqual(en.match(RE)?.slice(1), ["AI Vibe Coding Masterclass", "18", "Nov", "2026"]);
  const zh = workshopFormName("Claude AI 实战工作坊", "2027-03-05");
  assert.equal(zh, "LEAD - Claude AI 实战工作坊 5 Mar 2027");
  assert.deepEqual(zh.match(RE)?.slice(1), ["Claude AI 实战工作坊", "5", "Mar", "2027"]);
});

test("paths", () => {
  assert.equal(normalizePath(" /CN//Workshop/claude-ai-masterclass/ "), "/cn/workshop/claude-ai-masterclass");
  assert.equal(normalizePath("/"), "/");
  assert.ok(pathSchema.safeParse("/").success);
  assert.ok(pathSchema.safeParse("/cn/workshop").success);
  for (const bad of ["/a b", "/../x", "", "a", "/a/", "/A", "/a/b/c/d/e/f"]) {
    assert.equal(pathSchema.safeParse(bad).success, false, bad);
  }
});

test("permissions", () => {
  const edit = ["super_admin", "management", "marketing"];
  const view = [...edit, "sales", "operations"];
  for (const r of ROLES) {
    assert.equal(canEditSites(r), edit.includes(r), r);
    assert.equal(canViewSites(r), view.includes(r), r);
  }
});

test("formNameFor", () => {
  const base: LeadFormSettings = {
    type: "interest", fields: [], createDeal: false, after: { kind: "message", text: "ok" },
  };
  assert.equal(formNameFor({ ...base, formName: "" }, "ai-intro"), "page:ai-intro");
  assert.equal(formNameFor({ ...base, formName: "My form" }, "x"), "My form");
  assert.equal(
    formNameFor({ ...base, type: "workshop", workshop: { title: "T", date: "2026-11-18", language: "en" } }, "x"),
    "LEAD - T 18 Nov 2026",
  );
});
