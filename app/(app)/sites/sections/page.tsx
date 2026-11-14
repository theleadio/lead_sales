import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listGlobalSections } from "@/lib/sites/admin";
import { canViewSites } from "@/lib/sites/permissions";

// Global sections: one edit changes every page that uses the section.
// They are created and edited in the page editor.
export default async function SectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canViewSites(user.role)) redirect("/home");
  const sections = await listGlobalSections(user);
  return (
    <section className="max-w-3xl">
      <Link href="/sites" className="text-ink-muted text-sm underline">
        Sites &amp; funnels
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Global sections</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Shared blocks (header, footer, disclaimer). Create and edit them in the
        page editor.
      </p>
      {sections.length === 0 ? (
        <p className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center font-medium">
          No global sections yet
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {sections.map((s) => (
            <li
              key={s.id}
              className="border-line flex justify-between py-2 text-sm"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-ink-muted">v{s.version}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
