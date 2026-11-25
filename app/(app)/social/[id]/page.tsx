import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  CHANNEL_LABEL,
  CHANNELS,
  isAuto,
  needsHand,
  isEditable,
  MAX_BODY,
  MAX_IMAGES,
  mytDay,
  toMytInput,
} from "@/lib/social/planner";
import {
  canUseSocial,
  getPost,
  listMedia,
  type Post,
  type PostChannel,
} from "@/lib/social/social";
import { button, field, myt } from "../../ui";
import {
  deletePostAction,
  markPostedAction,
  retryAction,
  savePostAction,
} from "../actions";
import { MediaPicker } from "../media-picker";
import { HandKit, ResultNote, StateBadge } from "../shared";
import { SubmitButton } from "../submit-button";

// One post: while nothing of it has gone out, its words, images, channels
// and time; then, per channel, what happened.
export default async function PostPage({
  params,
  searchParams,
}: PageProps<"/social/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canUseSocial(user.role)) redirect("/home");
  const { id } = await params;
  const p = await getPost(id);
  if (!p) notFound();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const editable = isEditable(p.channels);
  const back = p.scheduledAt
    ? `/social?view=month&d=${mytDay(p.scheduledAt)}`
    : "/social";

  return (
    <section className="max-w-3xl">
      <Link href={back} className="text-ink-muted text-sm underline">
        Social planner
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {p.status === "draft" ? "Draft post" : "Scheduled post"}
        </h1>
        <StateBadge state={p.state} />
      </div>
      <p className="text-ink-muted mt-1 text-sm">
        {p.scheduledAt ? `Goes out ${myt(p.scheduledAt)} (Malaysia time)` : "No time yet"}
      </p>
      <ResultNote code={one(q.result)} why={one(q.why)} />

      {p.status === "scheduled" && <Channels p={p} />}
      {editable ? <Editor p={p} /> : <ReadOnly p={p} />}
    </section>
  );
}

async function Editor({ p }: { p: Post }) {
  const library = await listMedia();
  const chosen = new Set(p.channels.map((c) => c.channel));
  return (
    <>
      <form action={savePostAction} className="mt-6 space-y-5">
        <input type="hidden" name="id" value={p.id} />
        <label className="block text-sm">
          <span className="font-medium">Text</span>
          <textarea
            name="body"
            defaultValue={p.body}
            rows={8}
            maxLength={MAX_BODY}
            className={`${field} mt-1 w-full`}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Link (optional)</span>
          <span className="text-ink-muted block">
            On a post with images, Facebook shows the link inside the text.
          </span>
          <input
            name="link"
            type="url"
            defaultValue={p.link ?? ""}
            placeholder="https://"
            className={`${field} mt-1 w-full`}
          />
        </label>
        <fieldset className="text-sm">
          <legend className="font-medium">Images (optional)</legend>
          <div className="mt-1">
            <MediaPicker
              library={library.map((m) => ({ id: m.id, url: m.url, name: m.name }))}
              selected={p.media.map((m) => ({
                id: m.id,
                url: m.url,
                name: library.find((l) => l.id === m.id)?.name ?? "",
              }))}
              max={MAX_IMAGES}
            />
          </div>
        </fieldset>
        <fieldset className="text-sm">
          <legend className="font-medium">Channels</legend>
          <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="channels"
                  value={c}
                  defaultChecked={chosen.has(c)}
                />
                {CHANNEL_LABEL[c]}
                <span className="text-ink-muted text-xs">
                  {isAuto(c) ? "automatic when set up" : "by hand"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm">
          <span className="font-medium">Date and time (Malaysia time)</span>
          <input
            name="when"
            type="datetime-local"
            defaultValue={p.scheduledAt ? toMytInput(p.scheduledAt) : ""}
            className={`${field} mt-1 block`}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <SubmitButton name="intent" value="schedule" className={button}>
            {p.status === "scheduled" ? "Save and keep scheduled" : "Schedule"}
          </SubmitButton>
          <SubmitButton
            name="intent"
            value="draft"
            className={`${button} !bg-surface-muted !text-ink border-line border`}
          >
            {p.status === "scheduled" ? "Unschedule (back to draft)" : "Save draft"}
          </SubmitButton>
        </div>
      </form>

      <form action={deletePostAction} className="border-line mt-10 space-y-2 border-t pt-4">
        <input type="hidden" name="id" value={p.id} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" required className="mt-1" />
          <span>Delete this post. This can&apos;t be undone.</span>
        </label>
        <SubmitButton className="text-danger cursor-pointer text-sm underline" pending="Deleting…">
          Delete post
        </SubmitButton>
      </form>
    </>
  );
}

function ReadOnly({ p }: { p: Post }) {
  return (
    <div className="mt-6 space-y-4">
      <p className="text-ink-muted text-sm">
        Part of this post has gone out, so it can no longer be changed.
      </p>
      <div className="border-line rounded-2xl border p-4 text-sm whitespace-pre-wrap">
        {p.body || <span className="text-ink-muted">(no text)</span>}
        {p.link && (
          <p className="mt-2">
            <a href={p.link} className="underline" rel="noopener noreferrer" target="_blank">
              {p.link}
            </a>
          </p>
        )}
      </div>
      {p.media.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {p.media.map((m) => (
            <li key={m.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- library images are already sized by the uploader */}
              <img src={m.url} alt="Post image" className="aspect-square w-full rounded-lg object-cover" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CHANNEL_STATUS: Record<PostChannel["status"], string> = {
  pending: "Waiting",
  publishing: "Posting now",
  posted: "Posted",
  failed: "Failed",
};

function Channels({ p }: { p: Post }) {
  const now = new Date();
  const reached = p.scheduledAt !== null && p.scheduledAt <= now;
  const anyHand = p.channels.some((c) => c.status === "failed" || needsHand(c, p.scheduledAt, now));
  return (
    <div className="border-line mt-6 rounded-2xl border p-4">
      <h2 className="font-medium">Channels</h2>
      {(anyHand || reached) && (
        <div className="mt-2">
          <HandKit p={p} />
        </div>
      )}
      <ul className="mt-2 space-y-3 text-sm">
        {p.channels.map((c) => (
          <li key={c.channel} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-28 font-medium">{CHANNEL_LABEL[c.channel]}</span>
            <span className={c.status === "failed" ? "text-danger" : ""}>
              {CHANNEL_STATUS[c.status]}
              {c.status === "pending" && isAuto(c.channel) && !needsHand(c, p.scheduledAt, now) && " (goes out automatically)"}
              {c.status === "pending" && isAuto(c.channel) && needsHand(c, p.scheduledAt, now) && " (not posted automatically: post it by hand)"}
              {c.status === "pending" && !isAuto(c.channel) && !reached && " (post by hand when it's time)"}
              {c.postedAt && ` · ${myt(c.postedAt)}`}
            </span>
            {c.externalUrl && (
              <a href={c.externalUrl} className="underline" target="_blank" rel="noopener noreferrer">
                View post
              </a>
            )}
            {c.status === "failed" && c.error && (
              <span className="text-danger w-full">{c.error}</span>
            )}
            {c.status === "failed" && isAuto(c.channel) && (
              <form action={retryAction}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="channel" value={c.channel} />
                <SubmitButton className="cursor-pointer underline" pending="Retrying…">
                  Retry
                </SubmitButton>
              </form>
            )}
            {(c.status === "failed" || (c.status === "pending" && (!isAuto(c.channel) || needsHand(c, p.scheduledAt, now)))) && (
              <form action={markPostedAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="channel" value={c.channel} />
                <input
                  name="url"
                  type="url"
                  placeholder="Link to the live post (optional)"
                  className={`${field} w-64 py-1`}
                />
                <SubmitButton className="cursor-pointer underline">
                  {c.status === "failed" ? "I posted it by hand" : "Mark posted"}
                </SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
