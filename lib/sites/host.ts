// Pure host/path decisions, shared by proxy.ts and the serving code. No DB
// or Next imports: the proxy must stay light.
export const PUBLIC_HOST = "ai.thelead.io";

export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return h === PUBLIC_HOST || h === "site.localhost";
}

export type Route =
  | { action: "pass" } // public host, served as is (static runtime, site API, _next)
  | { action: "rewrite"; to: string }
  | { action: "notfound" }
  | { action: "app" }; // app host: session refresh and sign-in redirect

// Exactly what the public host serves outside the render route.
const PASS = [
  /^\/api\/site\/(form|checkout|view)$/,
  /^\/api\/site\/class\/[A-Za-z0-9_.-]+$/,
  /^\/site\/runtime\.(js|css)$/,
  /^\/_next\//,
];

// Decode once, refuse (null) anything that could be a traversal or smuggle a
// separator: undecodable, backslash, encoded slash, control chars, ".." segment.
function normalise(raw: string): string | null {
  if (/%(2f|5c)/i.test(raw)) return null;
  let p: string;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(p) || p.split("/").includes("..")) return null;
  return p.replace(/\/+/g, "/");
}

export function routeFor(host: string, path: string): Route {
  const p = normalise(path);
  if (p === null) return { action: "notfound" };
  // The render route never answers a direct request, on either host.
  const lower = p.toLowerCase();
  if (lower === "/site-render" || lower.startsWith("/site-render/")) return { action: "notfound" };
  if (isPublicHost(host)) {
    if (PASS.some((r) => r.test(p))) return { action: "pass" };
    return { action: "rewrite", to: `/site-render${p === "/" ? "" : p}` };
  }
  return { action: "app" };
}
