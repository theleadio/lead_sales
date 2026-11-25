// Email marketing's pure parts (lib/email/campaign.ts): the unsubscribe token,
// the sanitised and personalised body, and the Resend batch request. No
// database needed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanBody,
  renderCampaign,
  sendBatch,
  signUnsubscribe,
  unsubscribeUrl,
  verifyUnsubscribe,
} from "../lib/email/campaign.ts";

const ID = "3f1c2b7e-9d4a-4c1e-8a55-0b6f2c9d7e11";
const SECRET = "test-secret-1";

test("a signed unsubscribe token gives back the person id", () => {
  assert.equal(verifyUnsubscribe(signUnsubscribe(ID, SECRET), SECRET), ID);
});

test("a token with another secret, a changed id or no signature is refused", () => {
  const t = signUnsubscribe(ID, SECRET);
  assert.equal(verifyUnsubscribe(t, "other-secret"), null);
  const other = "4f1c2b7e-9d4a-4c1e-8a55-0b6f2c9d7e11";
  assert.equal(verifyUnsubscribe(`${other}.${t.split(".")[1]}`, SECRET), null);
  assert.equal(verifyUnsubscribe(ID, SECRET), null);
  assert.equal(verifyUnsubscribe(`${ID}.`, SECRET), null);
  assert.equal(verifyUnsubscribe("not-a-uuid.abc", SECRET), null);
  assert.equal(verifyUnsubscribe("", SECRET), null);
});

test("the unsubscribe URL carries the token, whatever the base's trailing slash", () => {
  const t = signUnsubscribe(ID, SECRET);
  assert.equal(
    unsubscribeUrl("https://app.example.test/", t),
    `https://app.example.test/api/email/unsubscribe?t=${encodeURIComponent(t)}`,
  );
});

test("cleanBody drops scripts, event handlers and javascript: links", () => {
  const out = cleanBody(
    `<p onclick="x()">Hi</p><script>alert(1)</script>` +
      `<a href="javascript:alert(1)">bad</a><a href="https://ok.test">ok</a>` +
      `<img src="http://insecure.test/a.png"><img src="https://ok.test/a.png">`,
  );
  assert.ok(!/script|onclick|javascript:|insecure/i.test(out), out);
  assert.match(out, /href="https:\/\/ok\.test"/);
  assert.match(out, /src="https:\/\/ok\.test\/a\.png"/);
});

test("renderCampaign fills {{name}} (escaped), falls back, and always adds the unsubscribe link", () => {
  const url = "https://app.example.test/api/email/unsubscribe?t=abc";
  const r = renderCampaign({
    bodyHtml: "<p>Hello {{ name }}!</p>",
    name: `<b>Mei</b> & Co`,
    language: "en",
    unsubscribeUrl: url,
  });
  assert.match(r.html, /Hello &lt;b&gt;Mei&lt;\/b&gt; &amp; Co!/);
  assert.ok(r.html.includes(`href="${url}"`));
  assert.ok(r.text.includes(url));

  const none = renderCampaign({
    bodyHtml: "<p>Hi {{name}}</p>",
    name: null,
    language: "zh",
    unsubscribeUrl: url,
  });
  assert.match(none.html, /Hi 您/);
  assert.match(none.html, /退订/);
});

function fakeResend(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const mail = {
  to: "a@example.test",
  subject: "Hello",
  html: "<p>x</p>",
  text: "x",
  unsubscribeUrl: "https://app.example.test/u?t=1",
};

test("sendBatch posts the whole batch once, with the key and one-click unsubscribe headers", async () => {
  const r = fakeResend(200);
  const out = await sendBatch({
    apiKey: "re_test",
    from: "LEAD <hello@lead.test>",
    emails: [mail, { ...mail, to: "b@example.test" }],
    idempotencyKey: "key-1",
    fetchImpl: r.fetchImpl,
  });
  assert.deepEqual(out, { ok: true });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, "https://api.resend.com/emails/batch");
  const headers = r.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer re_test");
  assert.equal(headers["Idempotency-Key"], "key-1");
  const body = JSON.parse(r.calls[0].init.body as string);
  assert.equal(body.length, 2);
  assert.deepEqual(body[1].to, ["b@example.test"]);
  assert.equal(body[0].headers["List-Unsubscribe"], `<${mail.unsubscribeUrl}>`);
  assert.equal(
    body[0].headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
});

test("sendBatch says which failures are worth retrying", async () => {
  const run = (status: number) =>
    sendBatch({
      apiKey: "k",
      from: "f",
      emails: [mail],
      idempotencyKey: "k",
      fetchImpl: fakeResend(status).fetchImpl,
    });
  assert.deepEqual(await run(429), {
    ok: false,
    error: "Resend answered 429",
    retry: true,
  });
  assert.deepEqual(await run(503), {
    ok: false,
    error: "Resend answered 503",
    retry: true,
  });
  assert.deepEqual(await run(422), {
    ok: false,
    error: "Resend answered 422",
    retry: false,
  });
  const down = await sendBatch({
    apiKey: "k",
    from: "f",
    emails: [mail],
    idempotencyKey: "k",
    fetchImpl: (async () => {
      throw new Error("boom with a@example.test");
    }) as typeof fetch,
  });
  assert.deepEqual(down, {
    ok: false,
    error: "Resend unreachable",
    retry: true,
  });
});
