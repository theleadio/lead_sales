import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Server Components / Route Handlers: reads the session from cookies.
// Never touches the DB directly — screens/services do that via /lib/db.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — middleware refreshes
            // the session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

// The signed-in user's id and email, or null. getClaims() verifies the
// access token's signature locally with the project's public signing key
// (fetched once and cached for 10 minutes), so a page no longer waits on a
// network round trip to Supabase Auth; getUser() made one on every call.
// A token is trusted until it expires (an hour at most); access is still
// checked against app_user.is_active on every request (current-user.ts).
// cache(): one check per request, however many components ask.
export const getSession = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    return {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
    };
  },
);
