// Automations (lib/automations): triggers start one run per cause, the
// kill switch, conditions, steps, waits, stop-if-replied, consent and
// "not connected" for sends, and who may edit. Each test is rolled back.
import { createHmac } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  canEditAutomations,
  saveAutomation,
  setAutomationActive,
} from "../lib/automations/admin.ts";
import {
  conditionsHold,
  stepsSchema,
  type Condition,
} from "../lib/automations/model.ts";
import { retryRun, runDue, type Sender } from "../lib/automations/run.ts";
import { webhooksFromEnv } from "../lib/automations/webhook.ts";
import { watchTriggers } from "../lib/automations/watch.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

const facts = {
  preferredLanguage: "zh",
  tags: ["vip"],
  email: "a@b.test",
  phone: null,
  event: { toStage: "won" },
};

test("conditions: all must hold; empty always holds", () => {
  const c = (x: Condition[]) => conditionsHold(x, facts);
  assert.equal(c([]), true);
  assert.equal(
    c([{ field: "person.preferred_language", op: "eq", value: "zh" }]),
    true,
  );
  assert.equal(c([{ field: "person.tag", op: "has", value: "VIP" }]), true);
  assert.equal(c([{ field: "person.tag", op: "lacks", value: "vip" }]), false);
  assert.equal(c([{ field: "person.phone", op: "missing" }]), true);
  assert.equal(c([{ field: "event.toStage", op: "eq", value: "won" }]), true);
  assert.equal(
    c([
      { field: "event.toStage", op: "eq", value: "won" },
      { field: "person.email", op: "missing" },
    ]),
    false,
  );
});

test("steps: validated, with defaults; a wait must be at least an hour", () => {
  const ok = stepsSchema.safeParse([
    { kind: "create_task", settings: { title: "Call them" } },
    { kind: "wait", settings: { days: 2 } },
  ]);
  assert.ok(ok.success);
  if (ok.success)
    assert.deepEqual(ok.data[0].settings, {
      title: "Call them",
      type: "follow_up",
      due: { nextWorkingDay: true },
      assignTo: "deal_owner",
    });
  assert.equal(
    stepsSchema.safeParse([{ kind: "wait", settings: {} }]).success,
    false,
  );
  assert.equal(
    stepsSchema.safeParse([{ kind: "send_sms", settings: {} }]).success,
    false,
  );
  assert.equal(stepsSchema.safeParse([]).success, false);
});

// Every source's cursor an hour back, no other automations, so each test
// sees only what it makes. Rows made here carry clock_timestamp(): inside
// one test transaction now() is frozen at its start, before an automation
// is switched on, while in production each CRM event commits on its own.
async function fresh() {
  const sql = db();
  await sql`DELETE FROM sales.automation`;
  await sql`DELETE FROM sales.automation_cursor`;
  await sql`
    INSERT INTO sales.automation_cursor (name, read_until)
    SELECT n, now() - interval '1 hour'
    FROM unnest(ARRAY['outbox','ticket','message','lms_account']) AS n`;
}

async function leadEvent(personId: string) {
  const [e] = await db()`
    INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload, created_at)
    VALUES ('LeadCaptured', 'person', ${personId},
            ${db().json({ personId, formName: "Test" } as never)},
            clock_timestamp())
    RETURNING id`;
  return e.id as string;
}

async function boss() {
  return newUser("management");
}

async function runOf(personId: string) {
  const [r] = await db()`
    SELECT r.*, (SELECT json_agg(l.outcome ORDER BY l.at) FROM sales.automation_log l
                 WHERE l.run_id = r.id) AS outcomes
    FROM sales.automation_run r WHERE r.person_id = ${personId}`;
  return r;
}

it("new lead: tag and a follow-up task, once, only while switched on", async () => {
  await fresh();
  const b = await boss();
  await newUser("super_admin");
  const id = await saveAutomation(b, {
    name: "New lead follow-up",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [
      { kind: "add_tag", settings: { tag: "New lead" } },
      {
        kind: "create_task",
        settings: {
          title: "Follow up the new lead",
          type: "follow_up",
          due: { nextWorkingDay: true },
          assignTo: "deal_owner",
        },
      },
    ],
  });

  const off = await newPerson("Before switch-on");
  await leadEvent(off);
  assert.equal(await watchTriggers(), 0, "new automations start off");

  await setAutomationActive(b, id, true);
  const p = await newPerson("Lead Person");
  await leadEvent(p);
  assert.equal(await watchTriggers(), 1);
  assert.equal(
    await watchTriggers(),
    0,
    "re-reading the overlap starts nothing new",
  );
  assert.equal((await runDue()).done, 1);

  const tags = await db()`
    SELECT t.name FROM person_tag pt JOIN tag t ON t.id = pt.tag_id WHERE pt.person_id = ${p}`;
  assert.deepEqual(
    tags.map((t) => t.name),
    ["New lead"],
  );
  const [task] =
    await db()`SELECT title, assigned_user_id, due_at FROM task WHERE person_id = ${p}`;
  assert.equal(task.title, "Follow up the new lead");
  assert.ok(task.assigned_user_id, "no deal: the duty super_admin");
  assert.ok(task.due_at > new Date());
  const r = await runOf(p);
  assert.equal(r.status, "done");
  assert.deepEqual(r.outcomes, ["started", "done", "done", "done"]);
  assert.equal(
    await runOf(off),
    undefined,
    "an event from before switch-on never runs",
  );
});

it("conditions decide whether a run starts", async () => {
  await fresh();
  const b = await boss();
  const id = await saveAutomation(b, {
    name: "Chinese leads",
    trigger: "LeadCaptured",
    conditions: [{ field: "person.preferred_language", op: "eq", value: "zh" }],
    steps: [{ kind: "add_tag", settings: { tag: "zh lead" } }],
  });
  await setAutomationActive(b, id, true);
  const en = await newPerson("English");
  const zh = await newPerson("Chinese");
  await db()`UPDATE person SET preferred_language = 'zh' WHERE id = ${zh}`;
  await leadEvent(en);
  await leadEvent(zh);
  assert.equal(await watchTriggers(), 1);
  assert.ok(await runOf(zh));
  assert.equal(await runOf(en), undefined);
});

it("wait holds the run; pausing holds it too; then it carries on", async () => {
  await fresh();
  const b = await boss();
  const id = await saveAutomation(b, {
    name: "Two-step",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [
      { kind: "wait", settings: { days: 2, hours: 0 } },
      { kind: "add_tag", settings: { tag: "After wait" } },
    ],
  });
  await setAutomationActive(b, id, true);
  const p = await newPerson("Waiter");
  await leadEvent(p);
  await watchTriggers();
  assert.equal((await runDue()).waiting, 1);
  let r = await runOf(p);
  assert.equal(r.status, "waiting");
  assert.equal(r.next_step, 2);
  assert.ok(r.next_run_at.getTime() > Date.now() + 47 * 3600_000);
  assert.equal((await runDue()).done, 0, "not due yet");

  await db()`UPDATE sales.automation_run SET next_run_at = now() WHERE person_id = ${p}`;
  await setAutomationActive(b, id, false);
  assert.deepEqual(
    await runDue(),
    { done: 0, waiting: 0, stopped: 0, failed: 0, retry: 0 },
    "paused: held",
  );
  await setAutomationActive(b, id, true);
  assert.equal((await runDue()).done, 1);
  r = await runOf(p);
  assert.equal(r.status, "done");
});

it("stop if replied: a customer message after the start stops the run", async () => {
  await fresh();
  const b = await boss();
  const id = await saveAutomation(b, {
    name: "Nudge",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [
      { kind: "wait", settings: { hours: 1, days: 0 } },
      { kind: "stop_if_replied", settings: {} },
      { kind: "add_tag", settings: { tag: "Nudged" } },
    ],
  });
  await setAutomationActive(b, id, true);
  const p = await newPerson("Replier");
  await leadEvent(p);
  await watchTriggers();
  await runDue();
  const [c] = await db()`
    INSERT INTO sales.conversation (person_id, channel, external_thread_id)
    VALUES (${p}, 'web_form', ${crypto.randomUUID()}) RETURNING id`;
  await db()`
    INSERT INTO sales.message (conversation_id, person_id, channel, direction, body, sent_at)
    VALUES (${c.id}, ${p}, 'web_form', 'in', 'Thanks!', clock_timestamp())`;
  await db()`UPDATE sales.automation_run SET next_run_at = now() WHERE person_id = ${p}`;
  assert.equal((await runDue()).stopped, 1);
  const tags = await db()`SELECT 1 FROM person_tag WHERE person_id = ${p}`;
  assert.equal(tags.length, 0);
});

it("sends: marketing needs consent; no sender = failed 'not connected'; a sender gets one call", async () => {
  await fresh();
  const b = await boss();
  const promo = await saveAutomation(b, {
    name: "Promo",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [
      {
        kind: "send_email",
        settings: { template: "promo", purpose: "marketing" },
      },
    ],
  });
  const service = await saveAutomation(b, {
    name: "Welcome",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [
      {
        kind: "send_email",
        settings: { template: "welcome", purpose: "service" },
      },
    ],
  });
  await setAutomationActive(b, promo, true);
  await setAutomationActive(b, service, true);
  const p = await newPerson("Mail Person");
  await db()`UPDATE person SET email = ${`m-${crypto.randomUUID().slice(0, 8)}@example.test`} WHERE id = ${p}`;
  await leadEvent(p);
  assert.equal(await watchTriggers(), 2);
  const r = await runDue({});
  assert.equal(r.done, 1, "promo: skipped for no consent, run done");
  assert.equal(r.failed, 1, "welcome: no email sender connected");
  const [failed] = await db()`
    SELECT r.id, r.last_error FROM sales.automation_run r
    WHERE r.person_id = ${p} AND r.automation_id = ${service}`;
  assert.match(failed.last_error, /Email isn't connected yet/);
  const [skip] = await db()`
    SELECT l.detail FROM sales.automation_log l JOIN sales.automation_run r ON r.id = l.run_id
    WHERE r.automation_id = ${promo} AND l.outcome = 'skipped'`;
  assert.match(skip.detail, /marketing_email consent/);

  // Connect a sender and retry: called once, with the run's idempotency key.
  const calls: string[] = [];
  const send: Sender = async (req) => {
    calls.push(`${req.template}:${req.to}:${req.idempotencyKey}`);
  };
  assert.equal(await retryRun(b, failed.id), true);
  assert.equal((await runDue({ email: send })).done, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^welcome:m-.*:auto:/);
});

it("a step that throws retries with backoff, then fails after 5 tries", async () => {
  await fresh();
  const b = await boss();
  const id = await saveAutomation(b, {
    name: "Flaky",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [
      {
        kind: "send_whatsapp",
        settings: { template: "hi", purpose: "service" },
      },
    ],
  });
  await setAutomationActive(b, id, true);
  const p = await newPerson("Flaky Person");
  await db()`UPDATE person SET phone_e164 = '+60123456789' WHERE id = ${p}`;
  await leadEvent(p);
  await watchTriggers();
  const down: Sender = async () => {
    throw new Error("WATI 503");
  };
  assert.equal((await runDue({ whatsapp: down })).retry, 1);
  let r = await runOf(p);
  assert.equal(r.status, "running");
  assert.ok(r.next_run_at > new Date());
  for (let i = 0; i < 4; i++) {
    await db()`UPDATE sales.automation_run SET next_run_at = now() WHERE person_id = ${p}`;
    await runDue({ whatsapp: down });
  }
  r = await runOf(p);
  assert.equal(r.status, "failed");
  assert.equal(r.attempts, 5);
  assert.match(r.last_error, /WATI 503/);
});

it("a ticket trigger starts a run when its condition holds", async () => {
  await fresh();
  const b = await boss();
  const t = await saveAutomation(b, {
    name: "On ticket",
    trigger: "TicketCreated",
    conditions: [{ field: "event.category", op: "eq", value: "receipt" }],
    steps: [{ kind: "add_tag", settings: { tag: "Asked for receipt" } }],
  });
  await setAutomationActive(b, t, true);
  const p = await newPerson("Ticket Person");
  const [cat] =
    await db()`SELECT team_id FROM sales.ticket_category WHERE code = 'receipt'`;
  await db()`
    INSERT INTO sales.ticket (person_id, source_channel, category, team_id, subject, sla_due_at, created_at)
    VALUES (${p}, 'manual', 'receipt', ${cat.team_id}, 'Receipt', now() + interval '1 day', clock_timestamp())`;
  assert.equal(await watchTriggers(), 1);
  assert.equal((await runDue()).done, 1);
});

it("only management, super_admin and sales may edit; marketing is refused and audited", async () => {
  assert.equal(canEditAutomations("sales"), true);
  assert.equal(canEditAutomations("marketing"), false);
  const m = await newUser("marketing");
  await assert.rejects(
    saveAutomation(m, {
      name: "x",
      trigger: "LeadCaptured",
      conditions: [],
      steps: [{ kind: "add_tag", settings: { tag: "x" } }],
    }),
    /Only management, super_admin and sales/,
  );
  const [a] = await db()`
    SELECT 1 FROM audit_log WHERE action = 'permission_denied' AND entity = 'automation' AND user_id = ${m.id}`;
  assert.ok(a);
});

it("'Run again' is for editors only; a refusal is audited, and a bad id changes nothing", async () => {
  await fresh();
  const b = await boss();
  const id = await saveAutomation(b, {
    name: "Retry guard",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [
      { kind: "send_email", settings: { template: "x", purpose: "service" } },
    ],
  });
  await setAutomationActive(b, id, true);
  const p = await newPerson("Guarded");
  await db()`UPDATE person SET email = ${`g-${crypto.randomUUID().slice(0, 8)}@example.test`} WHERE id = ${p}`;
  await leadEvent(p);
  await watchTriggers();
  await runDue({});
  const r = await runOf(p);
  assert.equal(r.status, "failed");

  const m = await newUser("marketing");
  await assert.rejects(
    retryRun(m, r.id),
    /Only management, super_admin and sales/,
  );
  assert.equal((await runOf(p)).status, "failed", "still failed");
  const [denied] = await db()`
    SELECT 1 FROM audit_log
    WHERE action = 'permission_denied' AND entity = 'automation_run' AND user_id = ${m.id}`;
  assert.ok(denied);
  assert.equal(await retryRun(b, "not-a-uuid"), false);
  assert.equal(await retryRun(b, r.id), true);
  assert.equal(
    await retryRun(b, r.id),
    false,
    "only a failed run can be retried",
  );
});

test("webhooks: https and a plain name only; the call is signed and keyed", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const fake = (async (url: URL, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response("", { status });
  }) as unknown as typeof fetch;
  const hooks = webhooksFromEnv(
    {
      AUTOMATION_WEBHOOKS:
        "zoom=https://n8n.example/webhook/abc?x=1, plain=http://n8n.example/x, Bad Name=https://n8n.example/y, constructor",
      AUTOMATION_WEBHOOK_SECRET: "s3cret",
    },
    fake,
  );
  assert.deepEqual([...hooks.keys()], ["zoom"]);
  await hooks.get("zoom")!({ a: 1 }, "auto:run:1");
  assert.equal(seen[0].url, "https://n8n.example/webhook/abc?x=1");
  const h = seen[0].init.headers as Record<string, string>;
  assert.equal(h["Idempotency-Key"], "auto:run:1");
  assert.equal(
    h["X-Lead-Signature"],
    "sha256=" + createHmac("sha256", "s3cret").update('{"a":1}').digest("hex"),
  );
  status = 500;
  await assert.rejects(hooks.get("zoom")!({}, "k"), (e: Error) => {
    assert.equal(e.message, 'Webhook "zoom" answered 500');
    return true;
  });
});

it("a call_webhook step posts the person and class once; an unknown name fails the run", async () => {
  await fresh();
  const b = await boss();
  const id = await saveAutomation(b, {
    name: "Zoom",
    trigger: "LeadCaptured",
    conditions: [],
    steps: [{ kind: "call_webhook", settings: { hook: "zoom" } }],
  });
  await setAutomationActive(b, id, true);
  const p = await newPerson("Webhook Person");
  await leadEvent(p);
  await watchTriggers();

  assert.equal((await runDue({})).failed, 1);
  assert.match((await runOf(p)).last_error, /Webhook "zoom" isn't set up/);

  const calls: { body: Record<string, unknown>; key: string }[] = [];
  const webhooks = new Map([
    [
      "zoom",
      async (body: unknown, key: string) => {
        calls.push({ body: body as Record<string, unknown>, key });
      },
    ],
  ]);
  assert.equal(await retryRun(b, (await runOf(p)).id), true);
  assert.equal((await runDue({ webhooks })).done, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.event, "LeadCaptured");
  assert.equal(
    (calls[0].body.person as { fullName: string }).fullName,
    "Webhook Person",
  );
  assert.equal(calls[0].body.class, null);
  assert.match(calls[0].key, /^auto:[0-9a-f-]{36}:1$/);
  assert.equal((await runDue({ webhooks })).done, 0, "not called twice");
  assert.equal(calls.length, 1);
});
