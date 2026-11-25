import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";
import { attentionCount, COUNTED } from "@/lib/home/attention";
import { NAV } from "./nav";
import { Sidebar } from "./sidebar";

const roleLabel = (role: string) => {
  const s = role.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// A red count beside a menu item; nothing when there is nothing waiting.
async function Count({ user, href }: { user: CurrentUser; href: string }) {
  const n = await attentionCount(user, href);
  if (!n) return null;
  return (
    <span
      className="bg-danger ml-auto rounded-full px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular-nums"
      aria-label={`${n} need attention`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

// The signed-in shell. A signed-in Supabase user with no active app_user
// (lib/auth/current-user.ts) is sent back to sign-in, as in lead_crm.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const items = NAV.filter((i) => !i.roles || i.roles.includes(user.role)).map(
    ({ href, label, icon, group, ready, phase }) => ({
      href,
      label,
      icon,
      group,
      ready,
      phase,
    }),
  );
  const counts = Object.fromEntries(
    items
      .filter((i) => (COUNTED as readonly string[]).includes(i.href))
      .map((i) => [
        i.href,
        <Suspense key={i.href} fallback={null}>
          <Count user={user} href={i.href} />
        </Suspense>,
      ]),
  );
  return (
    <div className="min-h-screen md:flex">
      <Sidebar
        items={items}
        user={{ fullName: user.fullName, roleLabel: roleLabel(user.role) }}
        counts={counts}
        signOut={signOutAction}
      />
      <main className="min-w-0 flex-1 px-4 pt-5 pb-10 md:px-8 md:pt-7 md:pb-12">
        {children}
      </main>
    </div>
  );
}
