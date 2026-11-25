import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { cleanBody } from "@/lib/email/campaign";
import {
  audienceSample,
  audienceSize,
  canEditEmail,
  getCampaign,
  listTags,
} from "@/lib/email/marketing";
import { listMedia } from "@/lib/social/social";
import { toMytInput } from "@/lib/social/planner";
import { MIN_SCHEDULE_AHEAD_MS } from "@/lib/email/marketing";
import { button, field, myt } from "../../ui";
import {
  duplicateAction,
  saveCampaignAction,
  sendCampaignAction,
  unscheduleAction,
} from "../actions";
import { ResultNote, StatusBadge } from "../shared";
import { EmailEditor } from "./editor";

// One campaign: its words and audience while it is a draft, when it goes
// while scheduled, then what the send did. Only a draft can be changed; any
// campaign can be copied into a new draft.
export default async function CampaignPage({
  params,
  searchParams,
}: PageProps<"/email/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditEmail(user.role)) redirect("/home");
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();
  const q = await searchParams;
  const result = Array.isArray(q.result) ? q.result[0] : q.result;

  return (
    <section className={c.status === "draft" ? "max-w-6xl" : "max-w-3xl"}>
      <Link href="/email" className="text-ink-muted text-sm underline">
        Email marketing
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <StatusBadge status={c.status} />
        <form action={duplicateAction} className="ml-auto">
          <input type="hidden" name="id" value={c.id} />
          <button
            type="submit"
            className="border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-1.5 text-sm"
          >
            Duplicate
          </button>
        </form>
      </div>
      <ResultNote code={result} />
      {c.note && c.status === "draft" && (
        <p
          role="alert"
          className="border-danger/40 bg-danger/5 text-danger mt-4 rounded-xl border px-4 py-3 text-sm"
        >
          {c.note}
        </p>
      )}
      {c.status === "draft" ? (
        <Draft c={c} />
      ) : c.status === "scheduled" ? (
        <Scheduled c={c} />
      ) : (
        <Sent c={c} />
      )}
    </section>
  );
}

async function Draft({
  c,
}: {
  c: NonNullable<Awaited<ReturnType<typeof getCampaign>>>;
}) {
  const audience = { tagIds: c.tagIds, language: c.language };
  const [tags, size, sample, media] = await Promise.all([
    listTags(),
    audienceSize(audience),
    audienceSample(audience),
    listMedia(),
  ]);
  const now = new Date();
  const earliest = toMytInput(new Date(now.getTime() + MIN_SCHEDULE_AHEAD_MS));
  return (
    <>
      <form action={saveCampaignAction} className="mt-6 space-y-4">
        <input type="hidden" name="id" value={c.id} />
        <div className="max-w-3xl space-y-4">
          <label className="block text-sm">
            <span className="font-medium">Name (only you see this)</span>
            <input
              name="name"
              defaultValue={c.name}
              required
              maxLength={120}
              className={`${field} mt-1 w-full`}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Subject</span>
            <input
              name="subject"
              defaultValue={c.subject}
              required
              maxLength={200}
              className={`${field} mt-1 w-full`}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Language</span>
            <select
              name="language"
              defaultValue={c.language ?? ""}
              className={`${field} mt-1 w-full`}
            >
              <option value="">
                Everyone (each person&apos;s own language)
              </option>
              <option value="en">English only</option>
              <option value="zh">Chinese only</option>
            </select>
          </label>
          <fieldset className="text-sm">
            <legend className="font-medium">Only people tagged (any of)</legend>
            <p className="text-ink-muted">
              Leave all unticked to include everyone who agreed.
            </p>
            <div className="border-line mt-1 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2">
              {tags.map((t) => (
                <label key={t.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="tagIds"
                    value={t.id}
                    defaultChecked={c.tagIds.includes(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <EmailEditor
          initialBlocks={c.blocks}
          initialHtml={c.bodyHtml}
          library={media.map((m) => ({ id: m.id, url: m.url, name: m.name }))}
        />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={button}>
            Save
          </button>
          <button
            type="submit"
            name="then"
            value="test"
            className={`${button} !bg-surface-muted !text-ink border-line border`}
          >
            Save and email me a test
          </button>
        </div>
      </form>

      <div className="border-line mt-8 max-w-3xl rounded-2xl border p-4">
        <h2 className="font-medium">Who gets it</h2>
        <p className="mt-1 text-2xl font-semibold">
          {size.toLocaleString("en-MY")}
          <span className="text-ink-muted text-sm font-normal">
            {" "}
            people (saved filters, with email consent)
          </span>
        </p>
        {sample.length > 0 && (
          <p className="text-ink-muted mt-1 text-sm">
            For example: {sample.map((s) => s.name ?? "(no name)").join(", ")}
          </p>
        )}
        <p className="text-ink-muted mt-1 text-sm">
          Save first: sending uses the saved email, not unsaved changes above.
        </p>
        <form action={sendCampaignAction} className="mt-4 space-y-3">
          <input type="hidden" name="id" value={c.id} />
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">When</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="when" value="now" defaultChecked />
              Now
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="when" value="later" />
              Later, at
              <input
                type="datetime-local"
                name="at"
                min={earliest}
                aria-label="Send at (Malaysia time)"
                className={field}
              />
              <span className="text-ink-muted">Malaysia time</span>
            </label>
            <p className="text-ink-muted">
              A scheduled campaign goes to whoever matches and has consent at
              that time, so the number can change.
            </p>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" required className="mt-1" />
            <span>
              I have read the email and sent myself a test. Send it to the{" "}
              {size.toLocaleString("en-MY")} people above (now or at the time I
              picked). Once it starts sending, it can&apos;t be undone.
            </span>
          </label>
          <button type="submit" className={button} disabled={size === 0}>
            Send or schedule
          </button>
          {size === 0 && (
            <p className="text-ink-muted text-sm">
              No one matches yet, so there is nothing to send.
            </p>
          )}
        </form>
      </div>
    </>
  );
}

async function Scheduled({
  c,
}: {
  c: NonNullable<Awaited<ReturnType<typeof getCampaign>>>;
}) {
  const size = await audienceSize({ tagIds: c.tagIds, language: c.language });
  return (
    <>
      <div className="border-line mt-6 rounded-2xl border p-4">
        <p className="text-ink-muted text-sm">Goes out</p>
        <p className="mt-1 text-2xl font-semibold">
          {c.scheduledAt ? myt(c.scheduledAt) : "—"}
        </p>
        <p className="text-ink-muted mt-1 text-sm">
          Malaysia time, within about 5 minutes. {size.toLocaleString("en-MY")}{" "}
          people match today; the final number is worked out when it goes.
        </p>
        <form action={unscheduleAction} className="mt-4">
          <input type="hidden" name="id" value={c.id} />
          <button
            type="submit"
            className="border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Cancel schedule and edit
          </button>
        </form>
      </div>
      <p className="text-ink-muted mt-4 text-sm">Subject: {c.subject}</p>
      <h2 className="mt-6 font-medium">The email</h2>
      <div
        className="border-line mt-2 rounded-2xl border p-4"
        dangerouslySetInnerHTML={{ __html: cleanBody(c.bodyHtml) }}
      />
    </>
  );
}

function Sent({
  c,
}: {
  c: NonNullable<Awaited<ReturnType<typeof getCampaign>>>;
}) {
  const n = c.counts;
  return (
    <>
      <p className="text-ink-muted mt-2 text-sm">
        Subject: {c.subject}
        {c.queuedAt ? ` · queued ${myt(c.queuedAt)}` : ""}
        {c.sentAt ? ` · finished ${myt(c.sentAt)}` : ""}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Sent", n.sent],
            ["Waiting", n.queued],
            ["Skipped (unsubscribed)", n.skipped],
            ["Failed", n.failed],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="border-line rounded-2xl border p-4">
            <p className="text-ink-muted text-sm">{label}</p>
            <p className="mt-1 text-2xl font-semibold">
              {v.toLocaleString("en-MY")}
            </p>
          </div>
        ))}
      </div>
      <h2 className="mt-8 font-medium">The email</h2>
      {/* Sanitised again on the way out: stored HTML is never trusted raw. */}
      <div
        className="border-line mt-2 rounded-2xl border p-4"
        dangerouslySetInnerHTML={{ __html: cleanBody(c.bodyHtml) }}
      />
    </>
  );
}
