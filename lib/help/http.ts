import { isIP } from "node:net";
import type { Env } from "./intake.ts";

// Request helpers for the public help form, as in the CRM's
// lib/public/guard.ts: the client IP and the CORS allow-list.

function firstIp(v: string | null): string | null {
  const first = v?.split(",")[0].trim();
  return first && isIP(first) ? first : null;
}

// x-real-ip, then the first x-forwarded-for hop, as the host sets them. Only
// sound behind a proxy that overwrites both (Netlify and Vercel do; worth
// checking for any other host).
export function requestIp(headers: Headers): string | null {
  return (
    firstIp(headers.get("x-real-ip")) ?? firstIp(headers.get("x-forwarded-for"))
  );
}

// PUBLIC_ALLOWED_ORIGINS="https://thelead.io,https://www.thelead.io": https
// origins only (http for localhost), never a wildcard.
export function allowedOrigins(env: Env): string[] {
  return (env.PUBLIC_ALLOWED_ORIGINS ?? "").split(",").flatMap((s) => {
    try {
      const u = new URL(s.trim());
      return u.protocol === "https:" || u.hostname === "localhost"
        ? [u.origin]
        : [];
    } catch {
      return [];
    }
  });
}

// No Origin: a same-site form post or a server. A present Origin must be on
// the list.
export function originAllowed(env: Env, origin: string | null): boolean {
  return origin === null || allowedOrigins(env).includes(origin);
}

export function withCors(env: Env, origin: string | null, res: Response) {
  res.headers.set("Vary", "Origin");
  if (origin && allowedOrigins(env).includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  return res;
}
