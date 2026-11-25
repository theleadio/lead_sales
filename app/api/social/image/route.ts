import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/errors";
import { getCurrentUser } from "@/lib/auth/current-user";
import { imageStoreFromEnv } from "@/lib/sites/images";
import {
  MAX_SOCIAL_IMAGE_BYTES,
  SocialError,
  uploadMedia,
} from "@/lib/social/social";

// POST /api/social/image: adds an image to the social planner's library
// (multipart, field "file"). Signed-in marketing, management and super_admin
// only; answers { id, url, name }.
// A route, not a Server Action, as for the Sites editor's uploads.
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
  if (Number(request.headers.get("content-length")) > MAX_SOCIAL_IMAGE_BYTES + 65536)
    return apiError(413, "too_large", "The image is larger than 4 MB.");

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return apiError(400, "bad_body", "Send the image as a form file.");
  }
  if (!(file instanceof File))
    return apiError(400, "bad_body", "Send the image as a form file.");
  if (file.size > MAX_SOCIAL_IMAGE_BYTES)
    return apiError(413, "too_large", "The image is larger than 4 MB.");
  try {
    const m = await uploadMedia(
      { id: user.id, role: user.role },
      { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name },
      store,
    );
    return Response.json({ id: m.id, url: m.url, name: m.name }, { status: 201 });
  } catch (e) {
    if (e instanceof SocialError)
      return e.code === "forbidden"
        ? apiError(403, "forbidden", e.message)
        : apiError(400, "invalid", e.message);
    console.error(
      "social image upload failed:",
      e instanceof Error ? e.message : String(e),
    );
    return apiError(500, "server_error", "The upload failed. Try again.");
  }
}
