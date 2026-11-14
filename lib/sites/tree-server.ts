// Server-only page helpers (Buffer-free size check, but pulls in sanitize-html).
// Keep tree.ts / elements.ts free of this so the client editor can import them.
import { pageSchema, MAX_PROJECT_BYTES, RICH_FIELDS, type Page, type Section } from "./tree.ts";
import { sanitizeRich } from "./richtext.ts";

// Parse untrusted JSON-ish input: size cap + schema.
export function parsePage(input: unknown): { ok: true; page: Page } | { ok: false; message: string } {
  if (new TextEncoder().encode(JSON.stringify(input) ?? "").length > MAX_PROJECT_BYTES) {
    return { ok: false, message: "Page is too large (limit 1.5 MB)" };
  }
  const r = pageSchema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, message: `${i.path.join(".")}: ${i.message}` };
  }
  return { ok: true, page: r.data };
}

// Sanitise exactly the rich fields listed in RICH_FIELDS; nothing else is touched.
export function sanitizePage(page: Page): Page {
  const fix = (s: Section): Section => ({
    ...s,
    rows: s.rows.map((r) => ({
      ...r,
      cols: r.cols.map((c) => ({
        ...c,
        els: c.els.map((e) => {
          const kind = RICH_FIELDS[e.type];
          const p = e.props as Record<string, unknown>;
          if (kind === "text" && typeof p.text === "string") return { ...e, props: { ...p, text: sanitizeRich(p.text) } };
          if (kind === "items" && Array.isArray(p.items)) {
            const items = p.items.map((i: unknown) =>
              Array.isArray(i) ? i.map((x) => sanitizeRich(String(x))) : sanitizeRich(String(i)),
            );
            return { ...e, props: { ...p, items } };
          }
          return e;
        }),
      })),
    })),
  });
  return { ...page, sections: page.sections.map(fix), popups: page.popups.map((p) => ({ ...p, sections: p.sections.map(fix) })) };
}
