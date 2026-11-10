import Image from "next/image";
import leadLogo from "@/public/brand/lead-logo.webp";

// The LEAD logo file (the same one lead_crm uses): the mark and the "LEAD"
// wordmark in dark ink, for the light surfaces this app has. The alt text is
// the wordmark, so "LEAD" + "Sales" beside it reads as the product name.
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
