import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  imageStoreFromEnv,
  MAX_IMAGE_BYTES,
  uploadPageImage,
} from "@/lib/pages/images";
import { TicketError } from "@/lib/tickets/service";

// POST /api/pages/image: the page editor's image upload (multipart, field
// "file"). Signed-in page editors only; answers { url }.
// A route, not a Server Action: actions are capped at 1 MB.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in first.");
  // The session is a cookie, so refuse a post from another site.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host"))
    return apiError(403, "origin_not_allowed", "Origin not allowed.");
  const store = imageStoreFromEnv(process.env);
  if (!store)
    return apiError(503, "not_configured", "Image upload is not set up yet.");
  if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES + 65536)
    return apiError(413, "too_large", "The image is larger than 4 MB.");

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return apiError(400, "bad_body", "Send the image as a form file.");
  }
  if (!(file instanceof File))
    return apiError(400, "bad_body", "Send the image as a form file.");
  if (file.size > MAX_IMAGE_BYTES)
    return apiError(413, "too_large", "The image is larger than 4 MB.");
  try {
    const url = await uploadPageImage(
      { id: user.id, role: user.role },
      new Uint8Array(await file.arrayBuffer()),
      store,
    );
    return Response.json({ url }, { status: 201 });
  } catch (e) {
    if (e instanceof TicketError)
      return apiError(e.code === "forbidden" ? 403 : 400, e.code, e.message);
    console.error(
      "page image upload failed:",
      e instanceof Error ? e.message : String(e),
    );
    return apiError(500, "server_error", "The upload failed. Try again.");
  }
}
