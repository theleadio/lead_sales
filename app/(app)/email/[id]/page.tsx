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
import { button, field, myt } from "../../ui";
import { saveCampaignAction, sendCampaignAction } from "../actions";
import { ResultNote, STATUS_LABEL } from "../shared";

// One campaign: its words and audience while it is a draft, then what the
// send did. A sent campaign can't be changed.
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
    <section className="max-w-3xl">
      <Link href="/email" className="text-ink-muted text-sm underline">
        Email marketing
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <span className="border-line rounded-full border px-2.5 py-0.5 text-xs">
          {STATUS_LABEL[c.status]}
        </span>
      </div>
      <ResultNote code={result} />
      {c.status === "draft" ? <Draft c={c} /> : <Sent c={c} />}
    </section>
  );
}

async function Draft({
  c,
}: {
  c: NonNullable<Awaited<ReturnType<typeof getCampaign>>>;
}) {
  const audience = { tagIds: c.tagIds, language: c.language };
  const [tags, size, sample] = await Promise.all([
    listTags(),
    audienceSize(audience),
    audienceSample(audience),
  ]);
  return (
    <>
      <form action={saveCampaignAction} className="mt-6 space-y-4">
        <input type="hidden" name="id" value={c.id} />
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
            <option value="">Everyone (each person&apos;s own language)</option>
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
        <label className="block text-sm">
          <span className="font-medium">Email (HTML)</span>
          <span className="text-ink-muted block">
            Use {"{{name}}"} for the person&apos;s name. An unsubscribe link is
            added at the bottom automatically.
          </span>
          <textarea
            name="bodyHtml"
            defaultValue={c.bodyHtml}
            rows={14}
            className={`${field} mt-1 w-full font-mono`}
          />
        </label>
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

      <div className="border-line mt-8 rounded-2xl border p-4">
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
        <form action={sendCampaignAction} className="mt-4 space-y-3">
          <input type="hidden" name="id" value={c.id} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" required className="mt-1" />
            <span>
              I have read the email and sent myself a test. Send it to these{" "}
              {size.toLocaleString("en-MY")} people. This can&apos;t be undone.
            </span>
          </label>
          <button type="submit" className={button} disabled={size === 0}>
            Send campaign
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
