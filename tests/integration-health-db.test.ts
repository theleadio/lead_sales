// Integration health (lib/health/integrations.ts), against a database with
// the CRM schema and lead_sales' sales schema. Each test empties what it
// reads first, inside its rolled-back transaction.
import { test } from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import {
  canSeeIntegrations,
  integrationHealth,
  retryIntegration,
  type IntegrationHealth,
} from "../lib/health/integrations.ts";
import { closeDb, db } from "../lib/sql.ts";
import { it } from "./seed.ts";

after(closeDb);

async function clean() {
  const sql = db();
  await sql`DELETE FROM event_outbox`;
  await sql`DELETE FROM sales.lms_notice`;
  await sql`DELETE FROM integration_event WHERE source IN ('stripe','lms','meta_leadgen')`;
  await sql`DELETE FROM meta_ad_insight`;
  await sql`DELETE FROM salesprocess_payment`;
}

const byKey = async (key: string): Promise<IntegrationHealth> =>
  (await integrationHealth()).find((h) => h.key === key)!;

async function outbox(state: "done" | "retrying" | "dead" | "stuck") {
  const sql = db();
  const [r] = await sql`
    INSERT INTO event_outbox (type, aggregate_type, aggregate_id, payload,
                              processed_at, attempts, last_error,
                              next_attempt_at, dead_at)
    VALUES ('PaymentRecorded', 'payment', gen_random_uuid(), '{}',
            ${state === "done" ? sql`now()` : sql`NULL`},
            ${state === "retrying" || state === "dead" ? 3 : 0},
            ${state === "done" ? null : "boom"},
            ${state === "stuck" ? sql`now() - interval '1 hour'` : sql`now()`},
            ${state === "dead" ? sql`now()` : sql`NULL`})
    RETURNING id`;
  return r.id as string;
}

async function notice(state: "sent" | "retrying" | "dead") {
  const [r] = await db()`
    INSERT INTO sales.lms_notice (kind, ref_id, source_key, attempts,
                                  sent_at, dead_at, last_error)
    VALUES ('class.updated', gen_random_uuid(), ${`t:${crypto.randomUUID()}`},
            ${state === "sent" ? 0 : 2},
            ${state === "sent" ? new Date() : null},
            ${state === "dead" ? new Date() : null},
            ${state === "sent" ? null : "LMS answered 503 to class.updated"})
    RETURNING id`;
  return r.id as string;
}

it("an empty system: queues ok, daily syncs down (never synced)", async () => {
  await clean();
  assert.deepEqual(
    (await integrationHealth()).map((h) => [h.key, h.status]),
    [
      ["crm_outbox", "ok"],
      ["lms_notices", "ok"],
      ["lms_inbound", "ok"],
      ["stripe_webhook", "ok"],
      ["meta_leads", "ok"],
      ["meta_ads_sync", "down"],
      ["salesprocess_sync", "down"],
    ],
  );
});

it("CRM outbox: retrying is degraded, a stuck queue is degraded, a dead row is down", async () => {
  await clean();
  await outbox("done");
  assert.equal((await byKey("crm_outbox")).status, "ok");
  await outbox("stuck");
  assert.equal((await byKey("crm_outbox")).status, "degraded");
  const dead = await outbox("dead");
  const h = await byKey("crm_outbox");
  assert.equal(h.status, "down");
  assert.deepEqual(
    h.retryable.map((r) => r.id),
    [dead],
  );
});

it("LMS notices read lead_sales' own queue, apart from the CRM outbox", async () => {
  await clean();
  await notice("sent");
  assert.equal((await byKey("lms_notices")).status, "ok");
  await notice("retrying");
  assert.equal((await byKey("lms_notices")).status, "degraded");
  await notice("dead");
  const h = await byKey("lms_notices");
  assert.equal(h.status, "down");
  assert.match(h.lastErrorMessage!, /503/);
  assert.equal((await byKey("crm_outbox")).status, "ok");
});

it("retry revives only the chosen queue's dead rows, or only the ids given", async () => {
  await clean();
  const n1 = await notice("dead");
  const n2 = await notice("dead");
  const o = await outbox("dead");
  assert.equal(
    await retryIntegration({ integration: "lms_notices", ids: [n1] }),
    1,
  );
  assert.equal(
    await retryIntegration({ integration: "lms_notices", ids: [o] }),
    0,
  );
  assert.equal(await retryIntegration({ integration: "lms_notices" }), 1);
  const [stillDead] =
    await db()`SELECT dead_at FROM event_outbox WHERE id = ${o}`;
  assert.ok(stillDead.dead_at, "the CRM outbox row was not touched");
  assert.equal(await retryIntegration({ integration: "crm_outbox" }), 1);
  void n2;
});

it("inbound webhooks: a failure is degraded, a day of failure is down", async () => {
  await clean();
  const sql = db();
  await sql`
    INSERT INTO integration_event (source, external_event_id, payload, status, processed_at, error)
    VALUES ('lms', 'm1', '{}', 'failed', now(), 'boom')`;
  assert.equal((await byKey("lms_inbound")).status, "degraded");
  await sql`UPDATE integration_event SET received_at = now() - interval '25 hours' WHERE source = 'lms'`;
  assert.equal((await byKey("lms_inbound")).status, "down");
  assert.equal((await byKey("stripe_webhook")).status, "ok");
});

it("daily syncs: fresh ok, one missed run degraded, two down", async () => {
  await clean();
  const seed = (h: number) => db()`
    INSERT INTO salesprocess_payment (id, ghl_contact_id, status, amount_myr,
                                      currency, live_mode, paid_at, synced_at)
    VALUES (${crypto.randomUUID()}, 'c', 'succeeded', 100, 'MYR', true, now(),
            now() - make_interval(hours => ${h}))`;
  await seed(60);
  assert.equal((await byKey("salesprocess_sync")).status, "down");
  await seed(30);
  assert.equal((await byKey("salesprocess_sync")).status, "degraded");
  await seed(1);
  assert.equal((await byKey("salesprocess_sync")).status, "ok");
});

test("only super_admin sees or retries integrations", () => {
  assert.equal(canSeeIntegrations({ role: "super_admin" }), true);
  for (const role of ["management", "operations", "sales", "support"] as const)
    assert.equal(canSeeIntegrations({ role }), false, role);
});
