import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routeFor } from "./lib/sites/host.ts";

// Refreshes the Supabase session cookie on every request and sends anyone
// not signed in to /sign-in. "Signed in" only: roles are checked per page and
// per route (lib/auth/current-user.ts), as in lead_crm.
export async function proxy(request: NextRequest) {
  // Public host: marketing-authored HTML is served here and must never meet a
  // session cookie, so no Supabase client, refresh or sign-in redirect.
  const route = routeFor(
    request.headers.get("host") ?? "",
    request.nextUrl.pathname,
  );
  if (route.action === "notfound") return new NextResponse(null, { status: 404 });
  if (route.action === "pass") return NextResponse.next();
  if (route.action === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = route.to;
    return NextResponse.rewrite(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // API routes and webhooks authenticate themselves.
  if (request.nextUrl.pathname.startsWith("/api")) {
    await supabase.auth.getSession();
    return response;
  }

  // No public pages: the help form moved to lead_crm with its migration 019.
  const path = request.nextUrl.pathname;
  const { data } = await supabase.auth.getUser();
  if (!data.user && path !== "/sign-in") {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", path);
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
