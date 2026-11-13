import { createClient } from "@supabase/supabase-js";
import sanitizeHtml from "sanitize-html";
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

// An SVG can carry script, so it is accepted only as plain shapes: parsed in
// XML mode and rebuilt from an allowlist of elements and presentational
// attributes. If anything at all had to be dropped, the upload is refused (a
// rewritten file would not be what the editor chose), and what is stored is
// the rebuilt file, never the original bytes.
const SVG_TAGS = [
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "linearGradient",
  "radialGradient", "stop", "title", "desc", "text", "tspan", "clipPath", "mask",
];
const SVG_ATTRS = [
  "viewBox", "width", "height", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "points", "fill",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity",
  "transform", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "id", "clip-path",
  "mask", "xmlns", "font-size", "font-family", "text-anchor",
];
const SVG_NS = "http://www.w3.org/2000/svg";
// Only same-file references (url(#id)) are allowed inside a value.
const BAD_VALUE = /url\(\s*["']?\s*(?!#)|javascript:|data:|@import|&#|&[a-z]+;/i;

// The rebuilt SVG, or null when it held anything outside the allowlist.
export function sanitizeSvg(text: string): string | null {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) return null;
  let clean = true;
  const out = sanitizeHtml(text, {
    allowedTags: SVG_TAGS,
    allowedAttributes: { "*": SVG_ATTRS },
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
    disallowedTagsMode: "discard",
    transformTags: {
      "*": (tagName, attribs) => {
        if (!SVG_TAGS.includes(tagName)) clean = false;
        for (const [k, v] of Object.entries(attribs)) {
          if (!SVG_ATTRS.includes(k) || BAD_VALUE.test(v) || (k === "xmlns" && v !== SVG_NS)) clean = false;
        }
        return { tagName, attribs };
      },
    },
  });
  return clean && /^<svg[\s>]/.test(out) ? out : null;
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

export function checkImage(bytes: Uint8Array): { ext: string; mime: string; bytes: Uint8Array } {
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageError("The image is larger than 5 MB.");
  const type = imageType(bytes);
  if (!type) throw new ImageError("Use a JPG, PNG, WebP or SVG image.");
  if (type.ext !== "svg") return { ...type, bytes };
  const svg = sanitizeSvg(new TextDecoder().decode(bytes));
  if (svg === null) throw new ImageError("SVG contains unsupported content — export as plain shapes");
  return { ...type, bytes: new TextEncoder().encode(svg) };
}

export async function uploadSiteImage(
  viewer: { id: string; role: Role },
  bytes: Uint8Array,
  store: ImageStore,
): Promise<string> {
  await guard(viewer, "upload an image", true);
  const type = checkImage(bytes);
  bytes = type.bytes;
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
