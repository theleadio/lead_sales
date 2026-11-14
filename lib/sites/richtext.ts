// Limited rich text for page elements: b i u s a br, plus {{key}} tokens.
// Everything else (styles, classes, scripts, other tags) is stripped.
import sanitizeHtml from "sanitize-html";

export function sanitizeRich(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["b", "i", "u", "s", "a", "br"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    // "#anchor" hrefs have no scheme, so they pass; relative paths are dropped below.
    transformTags: {
      a: (tag, attribs) => ({
        tagName: tag,
        attribs: /^(https:|mailto:|tel:|#)/i.test((attribs.href ?? "").trim()) ? attribs : {},
      }),
    },
    disallowedTagsMode: "discard",
  });
}
