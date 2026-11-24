import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  canSeePayments,
  isPaymentView,
  listPayments,
  paymentSummary,
  type PaymentRow,
  type PaymentView,
} from "@/lib/payments/list";
import { field, myt } from "../ui";

// Payments (build plan phase 2b): every payment the CRM holds, read-only.
// Recording a manual payment stays on the CRM's enrolment screen, and an
// unmatched Stripe payment is matched from its CRM task (§11.3, lead_crm), so
// rows link there. Who sees what: lib/payments/list.ts.

const VIEW_LABEL: Record<PaymentView, string> = {
  all: "All",
  unmatched: "Unmatched",
  refunds: "Refunds",
};

const METHOD_LABEL: Record<string, string> = {
  stripe_card: "Card (Stripe)",
  stripe_fpx: "FPX (Stripe)",
  bank_transfer: "Bank transfer",
  hrdc: "HRDC",
  invoice: "Invoice",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  succeeded: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  partially_refunded: "Part refunded",
};

const rm = (v: string) =>
  `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Links into lead_crm, where people, enrolments and tasks are opened and
// changed. Without CRM_BASE_URL the words show without a link.
function crmHref(path: string): string | null {
  const base = process.env.CRM_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}${path}` : null;
}

function CrmLink({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  const href = crmHref(path);
  return href ? (
    <a href={href} className="underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="border-line rounded-2xl border p-4">
      <p className="text-ink-muted text-xs">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-ink-muted mt-0.5 text-xs">{note}</p>}
    </div>
  );
}

function Who({ row }: { row: PaymentRow }) {
  if (!row.matched)
    return (
      <span>
        <span className="text-danger font-medium">Unmatched</span>
        {row.openMatchTaskId ? (
          <span className="text-ink-muted">
            {" "}
            ·{" "}
            <CrmLink path="/tasks?mine=false&type=match_payment">
              match in CRM
            </CrmLink>
          </span>
        ) : null}
      </span>
    );
  if (!row.personId) return <span className="text-ink-muted">No person</span>;
  return (
    <span>
      <CrmLink path={`/people/${row.personId}`}>{row.personName}</CrmLink>
      {row.personEmail && (
        <span className="text-ink-muted block text-xs">{row.personEmail}</span>
      )}
    </span>
  );
}

export default async function PaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!canSeePayments(user.role)) redirect("/home");

  const q = await searchParams;
  const rawView = one(q.view);
  const view: PaymentView = isPaymentView(rawView) ? rawView : "all";
  const search = (one(q.q) ?? "").slice(0, 200);
  const page = Math.max(1, Number.parseInt(one(q.page) ?? "1", 10) || 1);

  const [summary, { rows, hasMore }] = await Promise.all([
    paymentSummary(user),
    listPayments(user, { view, q: search, page }),
  ]);

  const hrefFor = (over: { view?: PaymentView; page?: number }) => {
    const p = new URLSearchParams();
    const v = over.view ?? view;
    if (v !== "all") p.set("view", v);
    if (search) p.set("q", search);
    const pg = over.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const s = p.toString();
    return s ? `/payments?${s}` : "/payments";
  };

  return (
    <section className="max-w-6xl">
      <h1 className="text-2xl font-semibold">Payments</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Every payment in the CRM, newest first. Record a manual payment on the
        enrolment in the CRM; match an unmatched Stripe payment from its CRM
        task.
        {user.role === "sales" && " You see payments on your own deals."}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Received this month"
          value={rm(summary.receivedThisMonthMyr)}
          note="Malaysia time"
        />
        <Tile
          label="Refunded this month"
          value={rm(summary.refundedThisMonthMyr)}
        />
        <Tile
          label="Unmatched, waiting"
          value={String(summary.unmatchedCount)}
          note={summary.unmatchedCount ? rm(summary.unmatchedMyr) : undefined}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1" aria-label="Payment views">
          {(Object.keys(VIEW_LABEL) as PaymentView[]).map((v) => (
            <Link
              key={v}
              href={hrefFor({ view: v })}
              aria-current={v === view ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm ${v === view ? "bg-lead-blue/50 font-medium" : "text-ink-muted hover:bg-surface-muted"}`}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </nav>
        <form action="/payments" className="flex gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Name, email, class, reference"
            aria-label="Search payments"
            className={`${field} w-64`}
          />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
          <p className="font-medium">
            {search
              ? "No payments match that search"
              : view === "unmatched"
                ? "Nothing to match"
                : "No payments yet"}
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Paid</th>
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 pr-4 font-medium">Class</th>
                <th className="py-2 pr-4 text-right font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Method</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-line border-t align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {myt(r.paidAt ?? r.createdAt)}
                  </td>
                  <td className="py-2 pr-4">
                    <Who row={r} />
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {r.enrolmentId && r.classCode ? (
                      <CrmLink path={`/enrolments/${r.enrolmentId}`}>
                        {r.classCode}
                      </CrmLink>
                    ) : (
                      <span className="text-ink-muted">–</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
                    {rm(r.amountMyr)}
                    {Number(r.refundedMyr) > 0 && (
                      <span className="text-ink-muted block text-xs">
                        {rm(r.refundedMyr)} refunded
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {METHOD_LABEL[r.method] ?? r.method}
                  </td>
                  <td className="py-2 pr-4">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </td>
                  <td className="text-ink-muted max-w-64 py-2 text-xs break-words">
                    {r.reference ?? (r.matched ? "" : r.notes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <div className="mt-4 flex justify-between text-sm">
          {page > 1 ? (
            <Link href={hrefFor({ page: page - 1 })} className="underline">
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={hrefFor({ page: page + 1 })} className="underline">
              Older
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
