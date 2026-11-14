import type { NextRequest } from "next/server";
import { crmScheduleCached } from "@/lib/sites/crm-api";
import { isPublicHost } from "@/lib/sites/host";

export const dynamic = "force-dynamic";

// Public class facts for a funnel's order form: price, dates, availability.
// The CRM feed lists only public, open/few-seats/full classes; anything else is 404.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!isPublicHost(req.headers.get("host") ?? "")) return new Response("Not found", { status: 404 });
  const { code } = await params;
  const r = await crmScheduleCached();
  if (r.kind === "error") return Response.json({ error: "unavailable" }, { status: 502 });
  const c = r.classes.find((x) => x.code === code);
  if (!c) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(
    {
      code: c.code,
      name: c.courseName,
      startDate: c.startDate,
      endDate: c.endDate,
      priceMyr: c.priceMyr,
      seatsLeft: null, // the CRM feed only exposes a label, not a count
      status: c.seatsLabel,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60",
        "Netlify-CDN-Cache-Control": "public, s-maxage=60",
      },
    },
  );
}
