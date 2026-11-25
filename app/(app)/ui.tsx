import Link from "next/link";

// Small shared pieces for the signed-in screens (kept from the ticket
// screens, which moved to lead_crm with its migration 019).

// Times are shown in Malaysia time, where the office is.
const fmt = new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
export const myt = (d: Date) => fmt.format(d);

export const field =
  "border-line bg-surface rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring";
export const button =
  "bg-action text-action-ink cursor-pointer rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// One badge style for every status in the app. The tone carries the meaning:
// green done/on, blue planned, amber in progress or partly done, red needs
// attention, grey idle.
export type Tone = "grey" | "blue" | "green" | "amber" | "red";
const TONE: Record<Tone, string> = {
  grey: "bg-surface-muted text-ink-muted",
  blue: "bg-info-soft text-info",
  green: "bg-ok-soft text-ok",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
};
export function Badge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

// A page's title, its one-line description and its main action.
export function PageHeader({
  title,
  lede,
  action,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lede && <p className="text-ink-muted mt-1 text-sm">{lede}</p>}
      </div>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-line bg-surface-muted mt-6 rounded-2xl border p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="text-ink-muted mt-1 text-sm">{children}</p>}
    </div>
  );
}

// A number with its label. With href it links to the screen behind it; with
// alert it turns red, for counts that need someone.
export function StatTile({
  label,
  value,
  note,
  href,
  alert,
  icon,
  trend,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  href?: string;
  alert?: boolean;
  icon?: React.ReactNode;
  trend?: number[];
}) {
  const body = (
    <>
      <span className="text-ink-muted flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </span>
      <span
        className={`mt-1 block text-2xl font-semibold tracking-tight tabular-nums ${alert ? "text-danger" : ""}`}
      >
        {value}
      </span>
      {note && <span className="text-ink-muted mt-0.5 block text-xs">{note}</span>}
      {trend && trend.length > 1 && <Sparkline values={trend} />}
    </>
  );
  const cls = `block rounded-2xl border p-4 ${alert ? "border-danger/30 bg-danger-soft" : "border-line"}`;
  return href ? (
    <Link
      href={href}
      className={`${cls} hover:border-lead-blue transition-colors hover:shadow-sm`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Tables: a bordered box that scrolls inside itself, with the header kept
// in view. Put `num` on number and money cells so they line up on the right.
export const table = {
  wrap: "border-line mt-4 max-h-[70vh] overflow-auto rounded-2xl border",
  table: "w-full text-left text-sm",
  th: "bg-surface-muted text-ink-muted sticky top-0 z-10 border-line border-b px-4 py-2.5 text-xs font-medium whitespace-nowrap",
  td: "border-line border-t px-4 py-3 align-middle",
  num: "text-right tabular-nums whitespace-nowrap",
  row: "hover:bg-surface-muted/70 transition-colors [&:first-child>td]:border-t-0",
};

// A small trend line, oldest value first, scaled to its own highest value.
// All zeros draw a flat line along the bottom.
export function Sparkline({ values }: { values: number[] }) {
  const w = 160;
  const h = 30;
  const max = Math.max(...values, 0);
  const pts = values.map((v, i) => [
    (i * w) / (values.length - 1),
    h - 3 - (max > 0 ? (v / max) * (h - 8) : 0),
  ]);
  const d = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="mt-2 block h-[30px] w-full"
    >
      <path d={`${d} L${w} ${h} L0 ${h} Z`} className="fill-info-soft" />
      <path
        d={d}
        fill="none"
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        className="stroke-info"
      />
      <circle cx={lx} cy={ly} r={2.5} className="fill-info" />
    </svg>
  );
}
