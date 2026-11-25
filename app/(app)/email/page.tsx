import Link from "next/link";
import { redirect } from "next/navigation";
import { Copy, Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canEditEmail,
  consentSummary,
  listCampaigns,
} from "@/lib/email/marketing";
import { RowLink } from "../row-link";
import {
  button,
  EmptyState,
  myt,
  page,
  PageHeader,
  searchField,
  Segmented,
  StatTile,
  table as t,
  tiles,
  Toolbar,
} from "../ui";
import { duplicateAction, newCampaignAction } from "./actions";
import { ResultNote, StatusBadge } from "./shared";

// Email marketing (build plan phase 3): newsletter campaigns. A campaign only
// goes to people who agreed to marketing email (PDPA), so the first thing
// this page shows is how many people that is.

type Filter = "all" | "drafts" | "sent";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "drafts", label: "Drafts" },
  { key: "sent", label: "Sent" },
];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EmailPage({ searchParams }: PageProps<"/email">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canEditEmail(user.role)) redirect("/home");
  const q = await searchParams;
  const result = one(q.result);
  const show: Filter = one(q.show) === "drafts" ? "drafts" : one(q.show) === "sent" ? "sent" : "all";
  const search = (one(q.q) ?? "").trim().slice(0, 200);
  const [all, consent] = await Promise.all([listCampaigns(), consentSummary()]);
  const campaigns = all.filter(
    (c) =>
      (show === "all" ||
        (show === "drafts"
          ? c.status === "draft" || c.status === "scheduled"
          : c.status === "sending" || c.status === "sent")) &&
      (!search ||
        `${c.name} ${c.subject}`.toLowerCase().includes(search.toLowerCase())),
  );
  const hrefFor = (f: Filter) => {
    const p = new URLSearchParams();
    if (f !== "all") p.set("show", f);
    if (search) p.set("q", search);
    const s = p.toString();
    return s ? `/email?${s}` : "/email";
  };

  return (
    <section className={page}>
      <PageHeader
        title="Email marketing"
        lede="Newsletters go only to people who agreed to marketing email."
        action={
          <form action={newCampaignAction}>
            <button type="submit" className={button}>
              <Plus className="size-[18px]" aria-hidden="true" />
              New campaign
            </button>
          </form>
        }
      />
      <ResultNote code={result} />

      <div className={tiles}>
        <StatTile
          label="Can be emailed"
          value={consent.consented.toLocaleString("en-MY")}
          note={`of ${consent.withEmail.toLocaleString("en-MY")} people with an email address`}
        />
      </div>
      {consent.consented === 0 && (
        <p className="text-ink-muted mt-2 max-w-[75ch] text-sm">
          No one has agreed to marketing email yet, so a campaign would reach
          no one. Website and Meta form sign-ups who tick the box are added
          automatically. For people who already opted in elsewhere, see
          docs/email-marketing.md (the consent import).
        </p>
      )}

      <Toolbar>
        <Segmented
          label="Filter"
          options={FILTERS.map((f) => ({
            label: f.label,
            href: hrefFor(f.key),
            current: f.key === show,
          }))}
        />
        <form action="/email" className="contents">
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search campaigns"
            aria-label="Search campaigns"
            className={searchField}
          />
        </form>
      </Toolbar>

      {campaigns.length === 0 ? (
        <EmptyState
          title={
            all.length === 0
              ? "No campaigns yet"
              : search
                ? "No campaigns match that search"
                : show === "sent"
                  ? "Nothing sent yet"
                  : "No drafts"
          }
        >
          {all.length === 0 &&
            "Start a new campaign, pick who it goes to and send yourself a test."}
        </EmptyState>
      ) : (
        <div className={t.wrap}>
          <table className={t.table}>
            <thead>
              <tr>
                <th className={t.th}>Name</th>
                <th className={t.th}>Status</th>
                <th className={`${t.th} text-right`}>Recipients</th>
                <th className={`${t.th} text-right`}>Sent</th>
                <th className={t.th}>Created</th>
                <th className={`${t.th} w-px`}>
                  <span className="sr-only">Duplicate</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <RowLink key={c.id} href={`/email/${c.id}`} className={t.row}>
                  <td className={t.td}>
                    <Link href={`/email/${c.id}`} className="font-medium">
                      {c.name}
                    </Link>
                  </td>
                  <td className={t.td}>
                    <StatusBadge status={c.status} />
                    {c.status === "scheduled" && c.scheduledAt && (
                      <span className={`${t.sub} mt-0.5`}>{myt(c.scheduledAt)}</span>
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
                          <span className={t.sub}>{c.counts.failed} failed</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={`${t.td} whitespace-nowrap`}>{myt(c.createdAt)}</td>
                  <td className={`${t.td} pl-0`}>
                    <form action={duplicateAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        title="Duplicate"
                        aria-label={`Duplicate ${c.name}`}
                        className="text-ink-muted hover:text-ink hover:bg-hover-nav grid cursor-pointer place-items-center rounded-md p-1.5"
                      >
                        <Copy className="size-4" aria-hidden="true" />
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
