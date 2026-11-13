import { createHmac } from "node:crypto";
import { HOOK_NAME } from "./model.ts";

// The "call a webhook" step: POSTs what happened to another system (the n8n
// flow that registers a student in Zoom, for one).
//
// A step names a webhook; it never holds an address. The addresses live in
// the environment, so personal data can only go where an admin has set up:
//   AUTOMATION_WEBHOOKS="zoom=https://n8n.example/webhook/abc,other=https://…"
//   AUTOMATION_WEBHOOK_SECRET   optional; signs the body (HMAC-SHA256) in
//                               X-Lead-Signature: sha256=<hex>
// https only. Errors carry the name and the status, never the address: a
// webhook address is often a secret in itself.

// `key` is unique per run and step, sent as Idempotency-Key.
// ponytail: nothing here remembers a call. If the worker dies between the
// POST and its commit, the step runs again and the receiver sees the same
// key twice; it must ignore the repeat.
export type Hook = (body: unknown, key: string) => Promise<void>;

export function webhooksFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Map<string, Hook> {
  const secret = (env.AUTOMATION_WEBHOOK_SECRET ?? "").trim();
  const hooks = new Map<string, Hook>();
  for (const part of (env.AUTOMATION_WEBHOOKS ?? "").split(",")) {
    const i = part.indexOf("=");
    const name = part.slice(0, Math.max(i, 0)).trim();
    let url: URL;
    try {
      url = new URL(part.slice(i + 1).trim());
    } catch {
      continue;
    }
    if (!HOOK_NAME.test(name) || url.protocol !== "https:") continue;
    hooks.set(name, async (body, key) => {
      const text = JSON.stringify(body);
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            ...(secret && {
              "X-Lead-Signature": `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`,
            }),
          },
          body: text,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error(`Webhook "${name}" could not be reached`);
      }
      if (!res.ok) throw new Error(`Webhook "${name}" answered ${res.status}`);
    });
  }
  return hooks;
}
