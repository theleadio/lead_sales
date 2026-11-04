import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session cookie on every request and sends anyone
// not signed in to /sign-in. "Signed in" only: roles are checked per page and
// per route (lib/auth/current-user.ts), as in lead_crm.
export async function proxy(request: NextRequest) {
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

  // Public pages: the help form is for customers, who have no account.
  const path = request.nextUrl.pathname;
  if (path === "/help" || path.startsWith("/help/")) return response;

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
