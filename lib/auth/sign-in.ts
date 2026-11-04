export const WRONG_LOGIN = "Wrong email or password. Try again.";

// A same-site path only: blocks https://evil.com, //evil.com and /\evil.com.
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next)
    ? next
    : "/inbox";
}
