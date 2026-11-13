import { createClient } from "@supabase/supabase-js";
import { writeAudit } from "../audit.ts";
import { TicketError, type Actor } from "../tickets/service.ts";
import { canEditPages } from "./admin.ts";

// Images for landing pages. A staff member uploads a file; it goes to a
// PUBLIC Supabase Storage bucket (PAGE_IMAGE_BUCKET) and the page stores the
// file's https link, like any other image link. The service-role key stays
// on the server, as in the CRM's lib/uploads/signer.ts.
//
// Only PNG, JPEG, WebP and GIF, told by the file's first bytes and not by
// its name. No SVG: an SVG can carry script.

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const starts = (b: Uint8Array, sig: number[], at = 0) =>
  sig.every((v, i) => b[at + i] === v);

export function imageType(b: Uint8Array): { ext: string; mime: string } | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47]))
    return { ext: "png", mime: "image/png" };
  if (starts(b, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (starts(b, [0x47, 0x49, 0x46, 0x38]))
    return { ext: "gif", mime: "image/gif" };
  if (
    starts(b, [0x52, 0x49, 0x46, 0x46]) &&
    starts(b, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return { ext: "webp", mime: "image/webp" };
  return null;
}

// Saves the bytes under the key and answers with the public https link.
export type ImageStore = (
  key: string,
  bytes: Uint8Array,
  mime: string,
) => Promise<string>;

export function imageStoreFromEnv(
  env: Record<string, string | undefined>,
): ImageStore | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.PAGE_IMAGE_BUCKET;
  if (!url || !key || !bucket) return null;
  const store = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from(bucket);
  return async (path, bytes, mime) => {
    const { error } = await store.upload(path, bytes, {
      contentType: mime,
      // The key is new for every upload, so the file never changes.
      cacheControl: "31536000",
    });
    if (error) throw new Error(`image upload failed: ${error.message}`);
    return store.getPublicUrl(path).data.publicUrl;
  };
}

export async function uploadPageImage(
  actor: Actor,
  bytes: Uint8Array,
  store: ImageStore,
): Promise<string> {
  if (!canEditPages(actor.role))
    throw new TicketError("forbidden", "You can't change pages.");
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new TicketError("invalid", "The image is larger than 4 MB.");
  const type = imageType(bytes);
  if (!type)
    throw new TicketError("invalid", "Use a PNG, JPEG, WebP or GIF image.");
  const key = `pages/${crypto.randomUUID()}.${type.ext}`;
  const url = await store(key, bytes, type.mime);
  await writeAudit({
    userId: actor.id,
    action: "create",
    entity: "page_image",
    entityId: null,
    before: null,
    after: { key, bytes: bytes.length },
  });
  return url;
}
