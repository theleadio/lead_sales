// Email through Resend (lib/email/resend.ts): the request the automations
// engine's email Sender makes, with Resend faked. Each test is rolled back.
import { after } from "node:test";
import assert from "node:assert/strict";
import { resendSender } from "../lib/email/resend.ts";
import type { SendRequest } from "../lib/automations/run.ts";
import { closeDb, db } from "../lib/sql.ts";
import { enrol, it, newClass, newCourse, newPerson } from "./seed.ts";

after(closeDb);

type Call = { url: string; init: RequestInit };

function fakeResend(status = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(status < 300 ? { id: "email-1" } : { message: "nope" }),
      { status },
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const req = (over: Partial<SendRequest>): SendRequest => ({
  channel: "email",
  template: "onboarding",
  personId: "",
  to: "student@example.test",
  language: "zh",
  context: {},
  idempotencyKey: "auto:run-1:0",
  ...over,
});

it("sends the language's template with class details, once per idempotency key", async () => {
  const courseId = await newCourse();
  await db()`UPDATE course SET name_en = 'AI Agents', name_zh = 'AI 智能体' WHERE id = ${courseId}`;
  const classId = await newClass({ courseId });
  await db()`UPDATE class SET start_time = '09:30', online_url = NULL WHERE id = ${classId}`;
  const personId = await newPerson("Tan Mei Ling");
  await db()`UPDATE person SET preferred_name = 'Mei' WHERE id = ${personId}`;
  await enrol(classId, "confirmed", { personId });

  const r = fakeResend();
  const send = resendSender({
    apiKey: "re_test",
    from: "LEAD <hello@lead.test>",
    fetchImpl: r.fetchImpl,
  });
  await send(req({ personId, context: { classId } }));

  assert.equal(r.calls.length, 1);
  const { url, init } = r.calls[0];
  assert.equal(url, "https://api.resend.com/emails");
  const h = init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer re_test");
  assert.equal(h["Idempotency-Key"], "auto:run-1:0");
  const body = JSON.parse(init.body as string);
  assert.equal(body.from, "LEAD <hello@lead.test>");
  assert.deepEqual(body.to, ["student@example.test"]);
  assert.equal(body.template.id, "onboarding-zh");
  const v = body.template.variables;
  assert.equal(v.name, "Mei");
  assert.equal(v.course_name, "AI 智能体", "the zh name for a zh send");
  assert.match(v.class_code, /^C-/);
  assert.match(v.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(v.start_time, "09:30");
  assert.equal(v.venue, "LEAD Training Centre");
  assert.equal(v.lms_url, "https://class.thelead.io/");
  assert.equal("online_url" in v, false, "no empty variables");
});

it("without a class: person fields only; the full name when there is no preferred name", async () => {
  const personId = await newPerson("Ahmad Faiz");
  const r = fakeResend();
  await resendSender({
    apiKey: "k",
    from: "f@lead.test",
    fetchImpl: r.fetchImpl,
  })(req({ personId, language: "en", template: "welcome" }));
  const body = JSON.parse(r.calls[0].init.body as string);
  assert.equal(body.template.id, "welcome-en");
  assert.deepEqual(body.template.variables, {
    name: "Ahmad Faiz",
    lms_url: "https://class.thelead.io/",
  });
});

it("a Resend error throws, so the engine retries the step", async () => {
  const personId = await newPerson("Retry Person");
  const r = fakeResend(503);
  await assert.rejects(
    resendSender({ apiKey: "k", from: "f@lead.test", fetchImpl: r.fetchImpl })(
      req({ personId }),
    ),
    /Resend answered 503/,
  );
});
