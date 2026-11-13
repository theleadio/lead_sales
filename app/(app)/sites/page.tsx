import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditPages, listPages } from "@/lib/pages/admin";
import { button, myt } from "../tickets/ui";

// Sites & forms: the landing pages. A page is built from blocks and is a
// draft until published; its lead form creates a CRM lead.
export default async function SitesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditPages(user.role)) redirect("/inbox");
  const pages = await listPages();

  return (
    <section className="max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sites &amp; forms</h1>
        <Link href="/sites/new" className={button}>
          New page
        </Link>
      </div>
      <p className="text-ink-muted mt-1 text-sm">
        Landing pages for ads and links. A new page is a draft until you publish
        it.
      </p>
      {pages.length === 0 ? (
        <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
          <p className="font-medium">No pages yet</p>
          <p className="text-ink-muted mt-1 text-sm">
            Start with a hero, a few lines about the course and a lead form.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Title</th>
                <th className="py-2 pr-4 font-medium">Address</th>
                <th className="py-2 pr-4 font-medium">Language</th>
                <th className="py-2 pr-4 font-medium">Changed</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} className="border-line border-t">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/sites/${p.id}`}
                      className="font-medium underline"
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">/p/{p.slug}</td>
                  <td className="py-2 pr-4">
                    {p.language === "zh" ? "中文" : "English"}
                  </td>
                  <td className="py-2 pr-4">{myt(p.updatedAt)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.published ? "bg-lead-blue/50" : "bg-surface-muted text-ink-muted"}`}
                    >
                      {p.published ? "Published" : "Draft"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
