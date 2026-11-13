import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canEditPages, pageDetail } from "@/lib/pages/admin";
import { publishPageAction } from "../actions";
import { PageEditor } from "../editor";

const RESULTS: Record<string, string> = {
  saved: "Saved.",
  published: "Published. Anyone with the link can see it.",
  unpublished: "Unpublished. Only staff can see it now.",
  forbidden: "You can't change pages.",
};

// One page: publish switch, preview link and the editor.
export default async function SitePage({
  params,
  searchParams,
}: PageProps<"/sites/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditPages(user.role)) redirect("/inbox");
  const page = await pageDetail((await params).id);
  if (!page) notFound();
  const q = await searchParams;
  const note =
    RESULTS[String(Array.isArray(q.result) ? q.result[0] : q.result)];

  return (
    <section className="max-w-3xl">
      <Link href="/sites" className="text-ink-muted text-sm underline">
        Sites &amp; forms
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{page.title}</h1>
        <form action={publishPageAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={page.id} />
          <input
            type="hidden"
            name="published"
            value={page.published ? "off" : "on"}
          />
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${page.published ? "bg-lead-blue/50" : "bg-surface-muted text-ink-muted"}`}
          >
            {page.published ? "Published" : "Draft"}
          </span>
          <button
            type="submit"
            className="border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-1.5 text-sm"
          >
            {page.published ? "Unpublish" : "Publish"}
          </button>
        </form>
        <a
          href={`/p/${page.slug}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
        >
          {page.published ? "Open page" : "Preview"}
        </a>
      </div>
      {note && (
        <p
          role="status"
          className="border-line bg-surface-muted mt-4 rounded-xl border px-4 py-3 text-sm"
        >
          {note}
        </p>
      )}
      <PageEditor
        key={page.updatedAt.toISOString()}
        id={page.id}
        title={page.title}
        slug={page.slug}
        description={page.description}
        language={page.language}
        blocks={page.blocks as never}
      />
    </section>
  );
}
