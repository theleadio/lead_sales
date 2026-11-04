// The LEAD mark in the logo colours: a charcoal circle, the yellow L and the
// grey-blue bars.
export function LeadMark({ size = 30 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="bg-charcoal flex items-center justify-center gap-0.5 rounded-full"
    >
      <span className="bg-lead-yellow h-3.5 w-1 rounded-[1px]" />
      <span className="flex flex-col gap-0.5">
        <span className="bg-lead-blue h-[2.5px] w-[9px] rounded-[1px]" />
        <span className="bg-lead-blue h-[2.5px] w-[7px] rounded-[1px]" />
        <span className="bg-lead-blue h-[2.5px] w-[9px] rounded-[1px]" />
      </span>
    </span>
  );
}
