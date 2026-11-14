// CDN purge by page cache tag (injectable fetch for tests). Skipped when the
// Netlify env is unset. Failures are logged, never thrown.
// ---- CDN purge (injectable for tests) ----

let purgeFetch: typeof fetch = (...a) => fetch(...a);
export function setPurgeFetch(f: typeof fetch) {
  purgeFetch = f;
}

export async function purge(pageIds: string[]) {
  const token = process.env.NETLIFY_PURGE_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;
  if (!token || !siteId) return;
  for (const id of pageIds) {
    try {
      const r = await purgeFetch("https://api.netlify.com/api/v1/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ site_id: siteId, cache_tags: [`page:${id}`] }),
      });
      if (!r.ok) console.error(`CDN purge for page ${id} failed: HTTP ${r.status}`);
    } catch (e) {
      console.error(`CDN purge for page ${id} failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }
}
