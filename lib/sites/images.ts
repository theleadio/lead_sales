import { createClient } from "@supabase/supabase-js";
import { writeAudit } from "../audit.ts";
import type { Role } from "../auth/roles.ts";
import { guard } from "./admin.ts";

// Images for funnel pages (moved from the page-builder draft, PR #29). An
// editor uploads a file; it goes to a PUBLIC Supabase Storage bucket
// (PAGE_IMAGE_BUCKET) and the page stores the file's https link. The
// service-role key stays on the server.
//
// JPEG, PNG, WebP and SVG, told by the file's first bytes and not its name.
// An SVG is accepted only when it carries no script, handler or embed.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class ImageError extends Error {}

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

// SVG can carry script (<script>, on* handlers, javascript: links, embeds), so
// it is refused rather than rewritten.
const SVG_BAD = /<\s*(script|foreignObject|iframe|embed|object|animate|set)\b|\bon[a-z]+\s*=|javascript:|data:text\/html|<!ENTITY/i;

export function svgIsSafe(text: string): boolean {
  return !SVG_BAD.test(text);
}

export function imageType(b: Uint8Array): { ext: string; mime: string } | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return { ext: "png", mime: "image/png" };
  if (starts(b, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8))
    return { ext: "webp", mime: "image/webp" };
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
    return { ext: "svg", mime: "image/svg+xml" };
  return null;
}

// Saves the bytes under the key and answers with the public https link.
export type ImageStore = (key: string, bytes: Uint8Array, mime: string) => Promise<string>;

export function imageStoreFromEnv(env: Record<string, string | undefined>): ImageStore | null {
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

export function checkImage(bytes: Uint8Array): { ext: string; mime: string } {
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageError("The image is larger than 5 MB.");
  const type = imageType(bytes);
  if (!type) throw new ImageError("Use a JPG, PNG, WebP or SVG image.");
  if (type.ext === "svg" && !svgIsSafe(new TextDecoder().decode(bytes)))
    throw new ImageError("That SVG contains script or embedded content and can't be used.");
  return type;
}

export async function uploadSiteImage(
  viewer: { id: string; role: Role },
  bytes: Uint8Array,
  store: ImageStore,
): Promise<string> {
  await guard(viewer, "upload an image", true);
  const type = checkImage(bytes);
  const key = `sites/${crypto.randomUUID()}.${type.ext}`;
  const url = await store(key, bytes, type.mime);
  await writeAudit({
    userId: viewer.id,
    action: "create",
    entity: "site_image",
    entityId: null,
    before: null,
    after: { key, bytes: bytes.length },
  });
  return url;
}
