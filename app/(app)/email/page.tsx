import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canEditEmail,
  consentSummary,
  listCampaigns,
} from "@/lib/email/marketing";
import { button, myt } from "../ui";
import { newCampaignAction } from "./actions";
import { ResultNote, STATUS_LABEL } from "./shared";

// Email marketing (build plan phase 3): newsletter campaigns. A campaign only
// goes to people who agreed to marketing email (PDPA), so the first thing
// this page shows is how many people that is.
export default async function EmailPage({ searchParams }: PageProps<"/email">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditEmail(user.role)) redirect("/home");
  const q = await searchParams;
  const result = Array.isArray(q.result) ? q.result[0] : q.result;
  const [campaigns, consent] = await Promise.all([
    listCampaigns(),
    consentSummary(),
  ]);

  return (
    <section className="max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Email marketing</h1>
        <form action={newCampaignAction}>
          <button type="submit" className={button}>
            New campaign
          </button>
        </form>
      </div>
      <p className="text-ink-muted mt-1 text-sm">
        Newsletters go only to people who agreed to marketing email.
      </p>
      <ResultNote code={result} />

      <div className="border-line mt-6 rounded-2xl border p-4">
        <p className="text-ink-muted text-sm">Can be emailed</p>
        <p className="mt-1 text-2xl font-semibold">
          {consent.consented.toLocaleString("en-MY")}
          <span className="text-ink-muted text-sm font-normal">
            {" "}
            of {consent.withEmail.toLocaleString("en-MY")} people with an email
            address
          </span>
        </p>
        {consent.consented === 0 && (
          <p className="text-ink-muted mt-2 text-sm">
            No one has agreed to marketing email yet, so a campaign would reach
            no one. Website and Meta form sign-ups who tick the box are added
            automatically. For people who already opted in elsewhere, see
            docs/email-marketing.md (the consent import).
          </p>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
          <p className="font-medium">No campaigns yet</p>
          <p className="text-ink-muted mt-1 text-sm">
            Start a new campaign, pick who it goes to and send yourself a test.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Recipients</th>
                <th className="py-2 pr-4 font-medium">Sent</th>
                <th className="py-2 pr-4 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-line border-t">
                  <td className="py-2 pr-4">
                    <Link href={`/email/${c.id}`} className="underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{STATUS_LABEL[c.status]}</td>
                  <td className="py-2 pr-4">{c.recipientCount ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {c.status === "draft"
                      ? "—"
                      : `${c.counts.sent}${c.counts.failed ? ` (${c.counts.failed} failed)` : ""}`}
                  </td>
                  <td className="py-2 pr-4">{myt(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
