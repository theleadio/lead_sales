import { postText } from "./planner.ts";

// Posting to LEAD's Facebook Page with the Graph API. No database here.
//
//   words only (and a link):  POST /{page}/feed     message, link
//   one image:                POST /{page}/photos   url, caption
//   several images:           POST /{page}/photos   url, published=false
//                             for each, then
//                             POST /{page}/feed     message, attached_media
//
// The Page token needs `pages_manage_posts` (and the permissions Meta pairs
// with it, such as `pages_read_engagement`); check Meta's current docs before
// creating it, because Meta changes these. The token goes in the POST body,
// never the URL, so it can't end up in a log.

export type FacebookConfig = {
  pageId: string;
  token: string;
  graphVersion: string;
  fetchImpl?: typeof fetch;
};

// The config from env, or null while any part is missing: the job then
// leaves Facebook posts waiting instead of failing them.
export function facebookConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): FacebookConfig | null {
  const pageId = env.FACEBOOK_PAGE_ID?.trim();
  const token = env.FACEBOOK_PAGE_TOKEN?.trim();
  if (!pageId || !token || !/^\d+$/.test(pageId)) return null;
  return {
    pageId,
    token,
    graphVersion: env.META_GRAPH_VERSION?.trim() || "v25.0",
  };
}

export type FacebookPost = {
  body: string;
  link: string | null;
  // Public https links, in order.
  imageUrls: string[];
};

export type FacebookResult =
  | { ok: true; id: string; url: string }
  // `retry`: worth another attempt later (Facebook busy or unreachable, or a
  // rate limit). The error is a short reason, never the token.
  | { ok: false; error: string; retry: boolean };

class GraphError extends Error {
  readonly retry: boolean;
  constructor(message: string, retry: boolean) {
    super(message);
    this.retry = retry;
  }
}

// Graph error codes Meta documents as passing: unknown/service errors and
// the rate limits.
const TRANSIENT = new Set([1, 2, 4, 17, 32, 341, 368]);

async function call(
  cfg: FacebookConfig,
  path: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const body = new URLSearchParams({ ...fields, access_token: cfg.token });
  let res: Response;
  try {
    res = await fetchImpl(
      `https://graph.facebook.com/${cfg.graphVersion}/${cfg.pageId}/${path}`,
      { method: "POST", body },
    );
  } catch {
    throw new GraphError("Facebook unreachable", true);
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // Not JSON: the status says enough.
  }
  if (res.ok && typeof json.id === "string") return json;
  const err = (json.error ?? {}) as {
    message?: unknown;
    code?: unknown;
    is_transient?: unknown;
  };
  const code = typeof err.code === "number" ? err.code : null;
  // Meta's message, cut short, with anything token-shaped removed.
  const msg =
    typeof err.message === "string"
      ? err.message.replace(/EAA[A-Za-z0-9]+/g, "[token]").slice(0, 160)
      : "";
  const retry =
    res.status === 429 ||
    res.status >= 500 ||
    err.is_transient === true ||
    (code !== null && TRANSIENT.has(code));
  throw new GraphError(
    `Facebook answered ${res.status}${code !== null ? ` (code ${code})` : ""}${msg ? `: ${msg}` : ""}`,
    retry,
  );
}

const postUrl = (id: string) => `https://www.facebook.com/${id}`;

export async function publishToFacebook(
  cfg: FacebookConfig,
  post: FacebookPost,
): Promise<FacebookResult> {
  try {
    if (post.imageUrls.length === 0) {
      const fields: Record<string, string> = { message: post.body.trim() };
      if (post.link) fields.link = post.link;
      const r = await call(cfg, "feed", fields);
      return { ok: true, id: r.id as string, url: postUrl(r.id as string) };
    }
    // A photo post can't carry a link card, so the link goes in the text.
    const text = postText(post.body, post.link, true);
    if (post.imageUrls.length === 1) {
      const r = await call(cfg, "photos", {
        url: post.imageUrls[0],
        caption: text,
      });
      // /photos answers the photo's id and, for a published photo, the
      // feed post's id; the post is what people see.
      const id = typeof r.post_id === "string" ? r.post_id : (r.id as string);
      return { ok: true, id, url: postUrl(id) };
    }
    const media: string[] = [];
    for (const url of post.imageUrls) {
      const r = await call(cfg, "photos", { url, published: "false" });
      media.push(r.id as string);
    }
    const r = await call(cfg, "feed", {
      message: text,
      attached_media: JSON.stringify(media.map((id) => ({ media_fbid: id }))),
    });
    return { ok: true, id: r.id as string, url: postUrl(r.id as string) };
  } catch (e) {
    if (e instanceof GraphError)
      return { ok: false, error: e.message, retry: e.retry };
    throw e;
  }
}
