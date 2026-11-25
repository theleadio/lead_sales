// Email marketing against the database: who a campaign reaches (consent, tags,
// language), queueing, the sending job (consent re-checked, no double send)
// and unsubscribing. Each test is rolled back. Skipped without DATABASE_URL.
import { after } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db } from "../lib/sql.ts";
import {
  audienceSize,
  duplicateCampaign,
  getCampaign,
  processEmailQueue,
  queueCampaign,
  queueDueCampaigns,
  saveCampaign,
  scheduleCampaign,
  unscheduleCampaign,
  unsubscribe,
  EmailError,
  type MailConfig,
} from "../lib/email/marketing.ts";
import { it, newPerson, newUser } from "./seed.ts";

after(closeDb);

async function person(opts: {
  consent?: boolean | null; // null: no consent row at all
  language?: "en" | "zh";
  tagId?: string;
}): Promise<string> {
  const id = await newPerson(`Mail ${crypto.randomUUID().slice(0, 6)}`);
  await db()`
    UPDATE person SET email = ${`${id}@mail.test`},
      email_norm = ${`${id}@mail.test`},
      preferred_language = ${opts.language ?? "en"}
    WHERE id = ${id}`;
  if (opts.consent !== null && opts.consent !== undefined)
    await db()`
      INSERT INTO consent (person_id, purpose, is_granted, source)
      VALUES (${id}, 'marketing_email', ${opts.consent}, 'test')`;
  if (opts.tagId)
    await db()`INSERT INTO person_tag (person_id, tag_id) VALUES (${id}, ${opts.tagId})`;
  return id;
}

async function newTag(): Promise<string> {
  const [t] = await db()`
    INSERT INTO tag (name) VALUES (${`t-${crypto.randomUUID()}`}) RETURNING id`;
  return t.id as string;
}

async function draft(tagIds: string[], language: "en" | "zh" | null = null) {
  const u = await newUser("marketing");
  const [c] = await db()`
    INSERT INTO sales.email_campaign (created_by, name, subject, body_html, tag_ids, language)
    VALUES (${u.id}, 'Test', 'Hello', '<p>Hi {{name}}</p>', ${tagIds}::uuid[], ${language})
    RETURNING id`;
  return { id: c.id as string, actor: u };
}

function fakeResend(status = 200) {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    for (const e of JSON.parse(init.body as string)) sent.push(e.to[0]);
    return new Response("{}", { status });
  }) as typeof fetch;
  const cfg: MailConfig = {
    apiKey: "re_test",
    from: "LEAD <hello@lead.test>",
    baseUrl: "https://app.example.test",
    secret: "s",
    fetchImpl,
  };
  return { sent, cfg };
}

it("reaches only people whose latest email consent is a grant, in the tag and language", async () => {
  const tag = await newTag();
  const yes = await person({ consent: true, tagId: tag });
  await person({ consent: null, tagId: tag }); // never asked
  const withdrew = await person({ consent: true, tagId: tag });
  await db()`
    INSERT INTO consent (person_id, purpose, is_granted, source, recorded_at)
    VALUES (${withdrew}, 'marketing_email', false, 'test', now() + interval '1 second')`;
  await person({ consent: true }); // wrong tag
  await person({ consent: true, tagId: tag, language: "zh" });

  assert.equal(await audienceSize({ tagIds: [tag], language: "en" }), 1);
  assert.equal(await audienceSize({ tagIds: [tag], language: null }), 2);
  const c = await draft([tag], "en");
  assert.equal(await queueCampaign(c.actor, c.id), 1);
  const [s] =
    await db()`SELECT person_id FROM sales.email_send WHERE campaign_id = ${c.id}`;
  assert.equal(s.person_id, yes);
});

it("won't queue with no audience, twice, or for a role that can't send", async () => {
  const tag = await newTag();
  const empty = await draft([tag]);
  await assert.rejects(queueCampaign(empty.actor, empty.id), EmailError);

  await person({ consent: true, tagId: tag });
  const c = await draft([tag]);
  await queueCampaign(c.actor, c.id);
  await assert.rejects(queueCampaign(c.actor, c.id), EmailError);

  const sales = await newUser("sales");
  const d = await draft([tag]);
  await assert.rejects(queueCampaign(sales, d.id), EmailError);
});

it("sends each queued person once, skips someone who unsubscribed meanwhile, and finishes the campaign", async () => {
  const tag = await newTag();
  const a = await person({ consent: true, tagId: tag });
  const b = await person({ consent: true, tagId: tag });
  const c = await draft([tag]);
  await queueCampaign(c.actor, c.id);
  assert.equal(await unsubscribe(b), true);

  const r = fakeResend();
  const out = await processEmailQueue(r.cfg);
  assert.equal(out.sent >= 1, true);
  assert.deepEqual(
    r.sent.filter((e) => e.startsWith(a) || e.startsWith(b)),
    [`${a}@mail.test`],
  );
  const rows = await db()`
    SELECT person_id, status FROM sales.email_send WHERE campaign_id = ${c.id}`;
  assert.equal(rows.find((x) => x.person_id === a)?.status, "sent");
  assert.equal(rows.find((x) => x.person_id === b)?.status, "skipped");
  const [camp] =
    await db()`SELECT status FROM sales.email_campaign WHERE id = ${c.id}`;
  assert.equal(camp.status, "sent");

  // A second run finds nothing left for this campaign.
  const again = fakeResend();
  await processEmailQueue(again.cfg);
  assert.deepEqual(
    again.sent.filter((e) => e.startsWith(a)),
    [],
  );
});

it("keeps rows queued, then fails them, when Resend keeps answering 503", async () => {
  const tag = await newTag();
  const a = await person({ consent: true, tagId: tag });
  const c = await draft([tag]);
  await queueCampaign(c.actor, c.id);
  const r = fakeResend(503);
  for (let i = 0; i < 3; i++) await processEmailQueue(r.cfg);
  const [row] = await db()`
    SELECT status, attempts FROM sales.email_send
    WHERE campaign_id = ${c.id} AND person_id = ${a}`;
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 3);
});

it("unsubscribe withdraws consent once, raises the event, and is safe to repeat", async () => {
  const a = await person({ consent: true });
  assert.equal(await unsubscribe(a), true);
  assert.equal(await unsubscribe(a), false);
  const [cur] = await db()`
    SELECT is_granted, source FROM consent_current
    WHERE person_id = ${a} AND purpose = 'marketing_email'`;
  assert.equal(cur.is_granted, false);
  assert.equal(cur.source, "unsubscribe_link");
  const [e] = await db()`
    SELECT count(*)::int AS n FROM event_outbox
    WHERE aggregate_id = ${a} AND type = 'ConsentChanged'`;
  assert.equal(e.n, 1);
});

const MIN = 60 * 1000;

it("schedules a draft, refuses a time too soon, and cancels back to draft", async () => {
  const tag = await newTag();
  await person({ consent: true, tagId: tag });
  const c = await draft([tag]);
  const now = new Date();
  await assert.rejects(
    scheduleCampaign(c.actor, c.id, new Date(now.getTime() + 2 * MIN), now),
    /10 minutes/,
  );
  await scheduleCampaign(
    c.actor,
    c.id,
    new Date(now.getTime() + 60 * MIN),
    now,
  );
  let row = await getCampaign(c.id);
  assert.equal(row?.status, "scheduled");
  // Scheduled campaigns can't be edited or sent now.
  await assert.rejects(queueCampaign(c.actor, c.id), EmailError);
  await unscheduleCampaign(c.actor, c.id);
  row = await getCampaign(c.id);
  assert.equal(row?.status, "draft");
  assert.equal(row?.scheduledAt, null);
});

it("the job queues a due campaign with the audience at that time, and leaves a future one", async () => {
  const tag = await newTag();
  await person({ consent: true, tagId: tag });
  const due = await draft([tag]);
  const later = await draft([tag]);
  const t0 = new Date();
  await scheduleCampaign(
    due.actor,
    due.id,
    new Date(t0.getTime() + 15 * MIN),
    t0,
  );
  await scheduleCampaign(
    later.actor,
    later.id,
    new Date(t0.getTime() + 120 * MIN),
    t0,
  );
  // Someone who agrees after it was scheduled is still included.
  await person({ consent: true, tagId: tag });
  const r = await queueDueCampaigns(new Date(t0.getTime() + 20 * MIN));
  assert.equal(r.queued, 1);
  assert.equal((await getCampaign(due.id))?.status, "sending");
  assert.equal((await getCampaign(due.id))?.recipientCount, 2);
  assert.equal((await getCampaign(later.id))?.status, "scheduled");
});

it("the job returns a campaign to draft with a note when no one matches or it is 12 hours late", async () => {
  const tag = await newTag();
  const empty = await draft([tag]);
  const late = await draft([]);
  await person({ consent: true });
  const t0 = new Date();
  await scheduleCampaign(
    empty.actor,
    empty.id,
    new Date(t0.getTime() + 15 * MIN),
    t0,
  );
  await scheduleCampaign(
    late.actor,
    late.id,
    new Date(t0.getTime() + 15 * MIN),
    t0,
  );
  const r = await queueDueCampaigns(
    new Date(t0.getTime() + 15 * MIN + 13 * 60 * MIN),
  );
  assert.equal(r.returned, 2);
  const e = await getCampaign(empty.id);
  const l = await getCampaign(late.id);
  assert.equal(e?.status, "draft");
  assert.match(e?.note ?? "", /12 hours/);
  assert.equal(l?.status, "draft");
  // Nothing was queued for either.
  const [n] = await db()`
    SELECT count(*)::int AS n FROM sales.email_send
    WHERE campaign_id IN (${empty.id}, ${late.id})`;
  assert.equal(n.n, 0);
});

it("duplicates any campaign into a new draft with the same email and audience", async () => {
  const tag = await newTag();
  await person({ consent: true, tagId: tag });
  const c = await draft([tag], "en");
  await saveCampaign(c.actor, {
    id: c.id,
    name: "November newsletter",
    subject: "Hello",
    language: "en",
    bodyHtml: "",
    blocks: [{ id: "h", type: "heading", text: "Hi", align: "left" }],
    tagIds: [tag],
  });
  await queueCampaign(c.actor, c.id);
  const copy = await duplicateCampaign(c.actor, c.id);
  const d = await getCampaign(copy);
  assert.equal(d?.status, "draft");
  assert.equal(d?.name, "Copy of November newsletter");
  assert.deepEqual(d?.tagIds, [tag]);
  assert.equal(d?.blocks?.[0]?.type, "heading");
  assert.match(d?.bodyHtml ?? "", /<h2[^>]*>Hi<\/h2>/);
  const sales = await newUser("sales");
  await assert.rejects(duplicateCampaign(sales, c.id), EmailError);
});
