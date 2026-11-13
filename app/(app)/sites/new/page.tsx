import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditPages } from "@/lib/pages/admin";
import { PageEditor } from "../editor";

export default async function NewSitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditPages(user.role)) redirect("/inbox");
  return (
    <section className="max-w-3xl">
      <Link href="/sites" className="text-ink-muted text-sm underline">
        Sites &amp; forms
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New page</h1>
      <PageEditor title="" slug="" description="" language="en" blocks={[]} />
    </section>
  );
}
