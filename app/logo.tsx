import Image from "next/image";
import leadLogo from "@/public/brand/lead-logo.webp";

// The LEAD logo file (the same one lead_crm uses): the mark and the "LEAD"
// wordmark in dark ink, for the light surfaces this app has.
export function LeadLogo({ height = 30 }: { height?: number }) {
  return (
    <Image
      src={leadLogo}
      alt="LEAD"
      height={height}
      loading="eager"
      style={{ height, width: "auto" }}
    />
  );
}

// The logo with the product name after a hairline, as lead_crm's sign-in
// shows "LEAD | CRM": a quiet suffix, not a second wordmark. Its capitals
// are sized to the logo's lettering (font about 0.55 of the logo's height),
// muted to 60% ink (about 5.2:1 on the sidebar grey, so it still passes AA
// as normal-size text), and nudged 2px down because the lettering sits below the image's
// centre. Read aloud it is "LEAD Sales": the alt text, then the name.
export function LeadProductLogo({
  name,
  height = 30,
}: {
  name: string;
  height?: number;
}) {
  return (
    <span className="flex items-center gap-3">
      <LeadLogo height={height} />
      <span
        aria-hidden="true"
        className="bg-ink/20 w-px"
        style={{ height: Math.round(height * 0.6) }}
      />
      <span
        className="text-ink/60 translate-y-0.5 leading-none font-semibold tracking-[0.12em] uppercase"
        style={{ fontSize: Math.round(height * 0.55) }}
      >
        {name}
      </span>
    </span>
  );
}
