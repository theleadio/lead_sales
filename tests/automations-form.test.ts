// What the automation editor posts (lib/automations/form.ts): a good form
// becomes an automation; a bad one is refused with the mistake named on its
// step. No database needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEditorForm } from "../lib/automations/form.ts";

const post = (over: Record<string, unknown> = {}) => ({
  id: "",
  name: "New lead follow-up",
  trigger: "LeadCaptured",
  conditions: JSON.stringify([
    { field: "person.preferred_language", op: "eq", value: "zh" },
  ]),
  steps: JSON.stringify([
    { kind: "add_tag", settings: { tag: "New lead" } },
    { kind: "wait", settings: { days: 1, hours: 0 } },
    {
      kind: "create_task",
      settings: {
        title: "Call them",
        type: "call",
        due: { hours: 4 },
        assignTo: "duty_super_admin",
      },
    },
  ]),
  ...over,
});

test("a good form becomes an automation", () => {
  const r = parseEditorForm(post());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.input.id, undefined, "a blank id means a new automation");
  assert.equal(r.input.trigger, "LeadCaptured");
  assert.equal(r.input.conditions.length, 1);
  assert.equal(r.input.steps.length, 3);
});

test("an existing automation keeps its id", () => {
  const id = crypto.randomUUID();
  const r = parseEditorForm(post({ id }));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.input.id, id);
  assert.equal(parseEditorForm(post({ id: "not-a-uuid" })).ok, false);
});

test("mistakes are named on their step or condition", () => {
  const r = parseEditorForm(
    post({
      conditions: JSON.stringify([
        { field: "person.tag", op: "has", value: "" },
      ]),
      steps: JSON.stringify([
        { kind: "add_tag", settings: { tag: "ok" } },
        { kind: "wait", settings: { days: 0, hours: 0 } },
        { kind: "send_sms", settings: {} },
        { kind: "create_task", settings: { title: "" } },
      ]),
    }),
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.some((e) => e.startsWith("Condition 1:")));
  assert.ok(!r.errors.some((e) => e.startsWith("Step 1:")), "step 1 is fine");
  assert.ok(r.errors.some((e) => e.startsWith("Step 2:") && /hour/.test(e)));
  assert.ok(r.errors.some((e) => e.startsWith("Step 3:")));
  assert.ok(r.errors.some((e) => e.startsWith("Step 4:")));
});

test("a name, a known trigger and at least one step are required", () => {
  const bad = (over: Record<string, unknown>) => {
    const r = parseEditorForm(post(over));
    return r.ok ? [] : r.errors;
  };
  assert.ok(bad({ name: "  " }).some((e) => /name/i.test(e)));
  assert.ok(bad({ trigger: "Anything" }).some((e) => /trigger/i.test(e)));
  assert.ok(bad({ steps: "[]" }).some((e) => /at least one step/i.test(e)));
});

test("unreadable or oversized input is refused, not thrown on", () => {
  assert.equal(parseEditorForm(post({ steps: "{not json" })).ok, false);
  assert.equal(parseEditorForm(post({ conditions: '{"a":1}' })).ok, false);
  assert.equal(parseEditorForm({}).ok, false);
  const many = JSON.stringify(
    Array.from({ length: 51 }, () => ({
      kind: "add_tag",
      settings: { tag: "x" },
    })),
  );
  const r = parseEditorForm(post({ steps: many }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => /Up to 50 steps/.test(e)));
  const huge = "x".repeat(100_001);
  assert.equal(parseEditorForm(post({ steps: huge })).ok, false);
});

test("event conditions only reach top-level event fields", () => {
  const ok = parseEditorForm(
    post({
      conditions: JSON.stringify([
        { field: "event.toStage", op: "eq", value: "won" },
      ]),
    }),
  );
  assert.ok(ok.ok);
  for (const field of [
    "event.",
    "event.a.b",
    "event.__proto__x y",
    "other.x",
  ]) {
    const r = parseEditorForm(
      post({
        conditions: JSON.stringify([{ field, op: "eq", value: "v" }]),
      }),
    );
    assert.equal(r.ok, false, field);
  }
});
