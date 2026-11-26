import type { NextRequest } from "next/server";
import { handleEmbed } from "@/lib/sites/embed";

export const dynamic = "force-dynamic";

// The framed HTML of a published page's Embed block (see lib/sites/embed.ts).
export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string; elementId: string }> }) {
  const { pageId, elementId } = await params;
  return handleEmbed(req.headers.get("host") ?? "", pageId, elementId);
}
