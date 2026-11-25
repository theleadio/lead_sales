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
  "border-line bg-surface rounded-lg border px-2.5 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring";
// The main action. Put a <Plus /> (or other icon) first for "New …" buttons.
export const button =
  "bg-action text-action-ink inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-[9px] text-sm font-medium hover:brightness-[1.15] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
// A quieter button: white with a hairline border.
export const ghostButton =
  "bg-surface text-ink ring-line inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-[9px] text-sm font-medium ring-1 ring-inset hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
// The search box in a screen's toolbar.
export const searchField =
  "border-line bg-surface min-w-0 flex-[1_1_200px] max-w-[280px] rounded-lg border px-2.5 py-2 text-sm focus-visible:outline-2 focus-visible:outline-focus-ring";

// The width every screen uses.
export const page = "max-w-[1040px]";

// A row of view switches that look like one control (All / Drafts / Sent).
// Each option is a link, so the view lives in the address and works without
// script. `disabled` options show but can't be picked.
export function Segmented({
  label,
  options,
}: {
  label: string;
  options: { label: React.ReactNode; href?: string; current?: boolean; disabled?: boolean; title?: string }[];
}) {
  return (
    <nav aria-label={label} className="bg-surface-muted inline-flex gap-0.5 rounded-[10px] p-[3px]">
      {options.map((o, i) => {
        const cls = `rounded-lg px-3 py-1.5 text-sm font-medium ${o.current ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ink-muted hover:text-ink"}`;
        return o.disabled || !o.href ? (
          <span key={i} title={o.title} aria-disabled="true" className={`${cls} cursor-default opacity-60 hover:text-ink-muted`}>
            {o.label}
          </span>
        ) : (
          <Link key={i} href={o.href} aria-current={o.current ? "page" : undefined} className={cls}>
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

// The strip under a header: view switches on the left, then search.
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mt-[18px] flex flex-wrap items-center gap-2">{children}</div>;
}

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
      <div className="min-w-[min(100%,280px)] flex-1">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-balance">{title}</h1>
        {lede && <p className="text-ink-muted mt-1 max-w-[75ch] text-sm">{lede}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
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
    <div className="border-line bg-surface-muted mt-3.5 rounded-[14px] border p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="text-ink-muted mt-1 text-sm">{children}</p>}
    </div>
  );
}

// Tiles in a row that fills the width, as many as fit at 190px or more.
export const tiles =
  "mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3";

// A number with its label. With href it links to the screen behind it; with
// alert it turns red, for counts that need someone; with ok it turns green,
// for a count that is clear (the demo's colours, both ways).
export function StatTile({
  label,
  value,
  note,
  href,
  alert,
  ok,
  icon,
  trend,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  href?: string;
  alert?: boolean;
  ok?: boolean;
  icon?: React.ReactNode;
  trend?: number[];
}) {
  const body = (
    <>
      <span className="text-ink-muted flex items-center gap-1.5 text-xs [&_svg]:size-[18px]">
        {icon}
        {label}
      </span>
      <span
        className={`block text-2xl font-semibold tracking-[-0.01em] tabular-nums ${alert ? "text-danger" : ok ? "text-ok" : ""}`}
      >
        {value}
      </span>
      {note && <span className="text-ink-muted block text-xs">{note}</span>}
      {trend && trend.length > 1 && <Sparkline values={trend} />}
    </>
  );
  const cls = `flex flex-col gap-1 rounded-[14px] border px-4 py-3.5 ${alert ? "border-[#f3c4bf] bg-danger-soft" : ok ? "border-[#b9dcc4] bg-ok-soft" : "border-line"}`;
  return href ? (
    <Link
      href={href}
      className={`${cls} hover:border-lead-blue transition-[border-color,box-shadow] hover:shadow-[0_2px_10px_rgba(44,86,116,.08)]`}
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
  wrap: "border-line mt-3.5 max-h-[520px] overflow-auto rounded-[14px] border",
  table: "w-full min-w-[640px] border-collapse text-left text-sm",
  th: "bg-surface-muted text-ink-muted sticky top-0 z-10 border-line border-b px-3.5 py-2.5 text-xs font-medium whitespace-nowrap",
  td: "border-line border-t px-3.5 py-3 align-middle",
  num: "text-right tabular-nums whitespace-nowrap",
  row: "hover:bg-hover-row transition-colors [&:first-child>td]:border-t-0",
  // A second, smaller line under a cell's main text.
  sub: "text-ink-muted block text-xs",
};

// A small trend line, oldest value first, scaled to its own highest value.
// A flat run (all zeros, say) draws its line across the middle, so the
// blue fill under it still shows, as in the demo.
export function Sparkline({ values }: { values: number[] }) {
  const w = 160;
  const h = 30;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => [
    (i * w) / (values.length - 1),
    max > min ? h - 3 - ((v - min) / (max - min)) * (h - 8) : h / 2,
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
      className="mt-1 block h-[30px] w-full"
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
