import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canUseSocial, listMedia } from "@/lib/social/social";
import { myt } from "../../ui";
import { removeMediaAction } from "../actions";
import { UploadButton } from "../media-picker";
import { ResultNote } from "../shared";
import { SubmitButton } from "../submit-button";

// 10 KB, 850 KB, 1.4 MB: small files no longer read "0.0 MB".
const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// The social image library: images uploaded once and used in any post.
export default async function LibraryPage({
  searchParams,
}: PageProps<"/social/library">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canUseSocial(user.role)) redirect("/home");
  const q = await searchParams;
  const result = Array.isArray(q.result) ? q.result[0] : q.result;
  const media = await listMedia();

  return (
    <section className="max-w-5xl">
      <Link href="/social" className="text-ink-muted text-sm underline">
        Social planner
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Image library</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Images here can be added to any post. They are stored at a public
        link, because Facebook fetches them from there.
      </p>
      <ResultNote code={result} />
      <div className="mt-6">
        <UploadButton />
      </div>
      {media.length === 0 ? (
        <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
          <p className="font-medium">No images yet</p>
          <p className="text-ink-muted mt-1 text-sm">
            Upload JPG or PNG images of up to 4 MB.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {media.map((m) => (
            <li key={m.id} className="border-line rounded-xl border p-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element -- library images are already sized by the uploader */}
              <img src={m.url} alt={m.name || "Library image"} className="aspect-square w-full rounded-lg object-cover" />
              <p className="mt-1 truncate font-medium" title={m.name}>
                {m.name || "(no name)"}
              </p>
              <p className="text-ink-muted">
                {fileSize(m.bytes)} · {myt(m.createdAt)}
              </p>
              <form action={removeMediaAction} className="mt-1">
                <input type="hidden" name="id" value={m.id} />
                <SubmitButton className="text-danger cursor-pointer underline" pending="Removing…">
                  Remove
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
