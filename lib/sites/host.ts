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

const PASS = [/^\/api\/site(\/|$)/, /^\/site\//, /^\/_next\//];
const isRender = (p: string) => p === "/site-render" || p.startsWith("/site-render/");

export function routeFor(host: string, path: string): Route {
  // The render route never answers a direct request, on either host.
  if (isRender(path)) return { action: "notfound" };
  if (isPublicHost(host)) {
    if (PASS.some((r) => r.test(path))) return { action: "pass" };
    return { action: "rewrite", to: `/site-render${path === "/" ? "" : path}` };
  }
  return { action: "app" };
}
