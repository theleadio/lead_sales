import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listTemplates } from "@/lib/sites/admin";
import { canViewSites } from "@/lib/sites/permissions";
import { myt } from "../../ui";

// Funnel templates: saved from a funnel's Settings tab, picked when creating one.
export default async function TemplatesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canViewSites(user.role)) redirect("/home");
  const templates = await listTemplates(user, "funnel");
  return (
    <section className="max-w-3xl">
      <Link href="/sites" className="text-ink-muted text-sm underline">
        Sites &amp; funnels
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Templates</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Save one from a funnel&apos;s Settings tab; choose it when creating a
        new funnel.
      </p>
      {templates.length === 0 ? (
        <p className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center font-medium">
          No templates yet
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {templates.map((t) => (
            <li
              key={t.id}
              className="border-line flex justify-between py-2 text-sm"
            >
              <span className="font-medium">{t.name}</span>
              <span className="text-ink-muted">{myt(t.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
