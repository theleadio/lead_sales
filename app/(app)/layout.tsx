import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";
import { LeadProductLogo } from "../logo";
import { NAV } from "./nav";

// The signed-in shell. A signed-in Supabase user with no active app_user
// (lib/auth/current-user.ts) is sent back to sign-in, as in lead_crm.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return (
    <div className="flex min-h-screen">
      <aside className="border-line bg-surface-muted flex w-56 flex-col border-r p-4">
        <div className="mb-6">
          <LeadProductLogo name="Sales" height={30} />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1 text-sm">
          {NAV.filter((i) => !i.roles || i.roles.includes(user.role)).map(
            (item) =>
              item.ready ? (
                <a
                  key={item.href}
                  href={item.href}
                  className="hover:bg-lead-blue/40 rounded-lg px-3 py-2 font-medium"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  key={item.href}
                  className="text-ink-muted flex justify-between rounded-lg px-3 py-2"
                >
                  {item.label}
                  <span className="bg-lead-yellow text-ink rounded-full px-2 text-[11px]">
                    Phase {item.phase}
                  </span>
                </span>
              ),
          )}
        </nav>
        <form action={signOutAction} className="mt-auto">
          <p className="text-ink-muted mb-2 truncate text-xs">
            {user.fullName}
          </p>
          <button
            type="submit"
            className="text-ink-muted hover:text-ink cursor-pointer text-sm underline"
          >
            Sign out
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
