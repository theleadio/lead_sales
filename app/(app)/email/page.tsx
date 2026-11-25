import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canEditEmail,
  consentSummary,
  listCampaigns,
} from "@/lib/email/marketing";
import { RowLink } from "../row-link";
import { button, EmptyState, myt, PageHeader, StatTile, table as t } from "../ui";
import { duplicateAction, newCampaignAction } from "./actions";
import { ResultNote, StatusBadge } from "./shared";

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
      <PageHeader
        title="Email marketing"
        lede="Newsletters go only to people who agreed to marketing email."
        action={
          <form action={newCampaignAction}>
            <button type="submit" className={button}>
              New campaign
            </button>
          </form>
        }
      />
      <ResultNote code={result} />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Can be emailed"
          value={consent.consented.toLocaleString("en-MY")}
          note={`of ${consent.withEmail.toLocaleString("en-MY")} people with an email address`}
        />
      </div>
      {consent.consented === 0 && (
        <p className="text-ink-muted mt-2 max-w-3xl text-sm">
          No one has agreed to marketing email yet, so a campaign would reach
          no one. Website and Meta form sign-ups who tick the box are added
          automatically. For people who already opted in elsewhere, see
          docs/email-marketing.md (the consent import).
        </p>
      )}

      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet">
          Start a new campaign, pick who it goes to and send yourself a test.
        </EmptyState>
      ) : (
        <div className={`${t.wrap} mt-6`}>
          <table className={t.table}>
            <thead>
              <tr>
                <th className={t.th}>Name</th>
                <th className={t.th}>Status</th>
                <th className={`${t.th} text-right`}>Recipients</th>
                <th className={`${t.th} text-right`}>Sent</th>
                <th className={t.th}>Created</th>
                <th className={t.th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <RowLink key={c.id} href={`/email/${c.id}`} className={t.row}>
                  <td className={t.td}>
                    <Link href={`/email/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={t.td}>
                    <StatusBadge status={c.status} />
                    {c.status === "scheduled" && c.scheduledAt && (
                      <span className="text-ink-muted mt-0.5 block text-xs">
                        {myt(c.scheduledAt)}
                      </span>
                    )}
                  </td>
                  <td className={`${t.td} ${t.num}`}>
                    {c.recipientCount?.toLocaleString("en-MY") ?? "—"}
                  </td>
                  <td className={`${t.td} ${t.num}`}>
                    {c.status === "draft" || c.status === "scheduled" ? (
                      "—"
                    ) : (
                      <>
                        {c.counts.sent.toLocaleString("en-MY")}
                        {c.counts.failed > 0 && (
                          <span className="text-danger block text-xs">
                            {c.counts.failed} failed
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={`${t.td} whitespace-nowrap`}>{myt(c.createdAt)}</td>
                  <td className={`${t.td} text-right`}>
                    <form action={duplicateAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="text-ink-muted hover:text-ink hover:bg-surface cursor-pointer rounded-md px-2 py-1 text-xs"
                        aria-label={`Duplicate ${c.name}`}
                      >
                        Duplicate
                      </button>
                    </form>
                  </td>
                </RowLink>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
