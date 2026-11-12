// The automations' WhatsApp sender (lib/wati/sender.ts). WATI is a fake fetch
// that records what it was asked. The sender commits its inbox row outside
// the run's transaction on purpose, so these tests use committed rows and
// clean up after themselves instead of the rolled-back `it`. Needs lead_crm's
// migrations 019 and 020 (its inbox tables).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Final } from "../lib/automations/run.ts";
import { closeDb, db } from "../lib/sql.ts";
import { watiSender } from "../lib/wati/sender.ts";

after(closeDb);

const skip = !process.env.DATABASE_URL && "no DATABASE_URL";

type Call = { url: string; body: Record<string, unknown> };
function fake(status = 200, json: unknown = { result: true }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return {
    calls,
    o: {
      host: "https://live-mt-server.wati.io/12345",
      token: "tok",
      fetchImpl,
    },
  };
}

// A committed person with a WhatsApp number; removed with everything the
// sender wrote for them.
async function withPerson(
  fn: (p: { id: string; number: string }) => Promise<void>,
  over: { fullName?: string; noName?: boolean } = {},
) {
  const number = `6012${Math.floor(1000000 + Math.random() * 8999999)}`;
  const [p] = await db()`
    INSERT INTO person (full_name, phone, phone_e164, whatsapp_e164,
                        needs_review, needs_review_reason)
    VALUES (${over.fullName ?? "Tan Mei Ling"}, ${number}, ${`+${number}`},
            ${`+${number}`}, ${over.noName ?? false},
            ${over.noName ? "no_name" : null})
    RETURNING id`;
  try {
    await fn({ id: p.id as string, number });
  } finally {
    await db()`
      DELETE FROM conversation_message WHERE conversation_id IN (
        SELECT id FROM conversation WHERE external_thread_id = ${number})`;
    await db()`DELETE FROM conversation WHERE external_thread_id = ${number}`;
    await db()`DELETE FROM person WHERE id = ${p.id}`;
  }
}

const req = (p: { id: string; number: string }, key: string) => ({
  channel: "whatsapp" as const,
  template: "onboarding",
  personId: p.id,
  to: `+${p.number}`,
  language: "en" as const,
  context: {},
  idempotencyKey: key,
});

const rowOf = async (key: string) =>
  (
    await db()`
      SELECT m.status, m.body, m.person_id, c.last_message_at
      FROM conversation_message m JOIN conversation c ON c.id = m.conversation_id
      WHERE m.external_message_id = ${key}`
  )[0];

const key = () => `auto:${crypto.randomUUID()}:1`;

test(
  "sends the template with our key as local_message_id; the row is saved first, then marked sent",
  { skip },
  () =>
    withPerson(async (p) => {
      const k = key();
      const { calls, o } = fake();
      await watiSender(o)(req(p, k));
      assert.equal(
        calls[0].url,
        "https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send",
      );
      const body = calls[0].body as {
        template_name: string;
        recipients: {
          target: string;
          local_message_id: string;
          custom_params: { name: string; value: string }[];
        }[];
      };
      assert.equal(body.template_name, "onboarding");
      assert.equal(body.recipients[0].target, p.number);
      assert.equal(body.recipients[0].local_message_id, k);
      assert.deepEqual(body.recipients[0].custom_params, [
        { name: "name", value: "Tan Mei Ling" },
      ]);
      const r = await rowOf(k);
      assert.deepEqual([r.status, r.body], ["sent", "[template onboarding]"]);
    }),
);

test("a second call with the same key never sends again", { skip }, () =>
  withPerson(async (p) => {
    const k = key();
    const first = fake();
    await watiSender(first.o)(req(p, k));
    const again = fake();
    await watiSender(again.o)(req(p, k));
    assert.equal(again.calls.length, 0);
  }),
);

test(
  "WATI refusing it marks the row failed and stops the run; sending again after a fix works",
  { skip },
  () =>
    withPerson(async (p) => {
      const k = key();
      for (const f of [fake(400), fake(200, { result: false })]) {
        await assert.rejects(watiSender(f.o)(req(p, k)), (e) => {
          assert.ok(e instanceof Final, "no retries for a refusal");
          assert.match((e as Error).message, /refused/);
          return true;
        });
        assert.equal((await rowOf(k)).status, "failed");
      }
      const fixed = fake();
      await watiSender(fixed.o)(req(p, k));
      assert.equal(fixed.calls.length, 1);
      assert.equal((await rowOf(k)).status, "sent");
    }),
);

test(
  "no clear answer (a 5xx) keeps the row queued and is not sent again",
  { skip },
  () =>
    withPerson(async (p) => {
      const k = key();
      await assert.rejects(watiSender(fake(503).o)(req(p, k)), (e) => {
        assert.ok(e instanceof Final);
        assert.match((e as Error).message, /not sent again/);
        return true;
      });
      assert.equal((await rowOf(k)).status, "queued");
      const later = fake();
      await watiSender(later.o)(req(p, k));
      assert.equal(later.calls.length, 0);
    }),
);

test(
  "WATI busy (429, 408) is retried, not refused: the row is freed and the next try sends it",
  { skip },
  () =>
    withPerson(async (p) => {
      const k = key();
      for (const status of [429, 408]) {
        await assert.rejects(watiSender(fake(status).o)(req(p, k)), (e) => {
          assert.ok(!(e instanceof Final), "the engine retries it");
          assert.match((e as Error).message, /busy.*tried again/);
          assert.doesNotMatch((e as Error).message, /template name/);
          return true;
        });
        assert.equal((await rowOf(k)).status, "failed");
      }
      const next = fake();
      await watiSender(next.o)(req(p, k));
      assert.equal(next.calls.length, 1);
      assert.equal((await rowOf(k)).status, "sent");
    }),
);

test("a bad WATI_API_HOST fails at once, without a call", { skip }, () =>
  withPerson(async (p) => {
    const k = key();
    const f = fake();
    await assert.rejects(
      watiSender({ ...f.o, host: "not a url" })(req(p, k)),
      /WATI_API_HOST/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal((await rowOf(k)).status, "failed");
  }),
);

test(
  "a person whose name is only their number is greeted as 'there'",
  { skip },
  () =>
    withPerson(
      async (p) => {
        const { calls, o } = fake();
        await watiSender(o)(req(p, key()));
        const params = (
          calls[0].body as {
            recipients: { custom_params: { value: string }[] }[];
          }
        ).recipients[0].custom_params;
        assert.equal(params[0].value, "there");
      },
      { fullName: "60123456789", noName: true },
    ),
);

test("an existing thread keeps its person and a newer time", { skip }, () =>
  withPerson(async (p) => {
    // The thread already belongs to someone else sharing the number, with a
    // last message in the future.
    const [other] = await db()`
      INSERT INTO person (full_name) VALUES ('Shared number') RETURNING id`;
    const future = new Date(Date.now() + 86_400_000);
    await db()`
      INSERT INTO conversation (person_id, channel, external_thread_id, last_message_at)
      VALUES (${other.id}, 'whatsapp', ${p.number}, ${future})`;
    try {
      const k = key();
      await watiSender(fake().o)(req(p, k));
      const r = await rowOf(k);
      assert.equal(r.person_id, other.id, "the thread's person");
      assert.deepEqual(r.last_message_at, future, "never moved back");
    } finally {
      await db()`
        DELETE FROM conversation_message WHERE conversation_id IN (
          SELECT id FROM conversation WHERE external_thread_id = ${p.number})`;
      await db()`DELETE FROM conversation WHERE external_thread_id = ${p.number}`;
      await db()`DELETE FROM person WHERE id = ${other.id}`;
    }
  }),
);
