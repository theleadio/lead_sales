// Publish-time cleaner for marketing-authored pages (main XSS defence for the
// public funnel host). Explicit allow-lists; everything else is stripped and
// reported in `removed`.
import sanitizeHtml from "sanitize-html";

const TAGS = [
  "div", "section", "header", "footer", "nav", "main", "article", "aside", "span",
  "p", "br", "hr", "a", "button", "img", "iframe",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code",
  "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "mark",
  "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "label",
];

const GLOBAL_ATTRS = ["class", "id", "style", "title", "role", "aria-label", "data-lead", "data-id", "data-settings"];
const TAG_ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel"],
  button: ["type"],
  img: ["src", "alt", "width", "height", "loading"],
  iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "loading"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
};
const URL_ATTRS = new Set(["href", "src"]);
const SCHEMES = ["https", "mailto", "tel"];

const IFRAME_PREFIXES = [
  "https://www.youtube.com/embed/",
  "https://www.youtube-nocookie.com/embed/",
  "https://player.vimeo.com/video/",
  "https://www.google.com/maps/embed",
];

// Strip whitespace/control chars browsers ignore inside a scheme, then check it.
function urlAllowed(raw: string): boolean {
  const v = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (/^(#|\/(?!\/)|\?)/.test(v)) return true; // fragment / same-site path
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (m) return SCHEMES.includes(m[1].toLowerCase());
  return !v.startsWith("//"); // bare relative ok, protocol-relative not
}

const BAD_CSS =
  /expression\(|javascript:|vbscript:|-moz-binding|behavior:|url\(["']?data:(?!image\/(png|jpe?g|gif|webp)[;,])/i;

// Normalise the way a CSS parser would before we pattern-match: drop comments,
// decode backslash escapes, drop whitespace/control chars.
function cssNorm(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff) || 0xfffd))
    .replace(/\\([\s\S])/g, "$1")
    .replace(/[\u0000- \u007f-\u009f]/g, "");
}

function cleanCss(css: string, removed: string[], where: string): string {
  let out = css;
  if (out.includes("<")) {
    out = out.replace(/</g, "");
    removed.push(`"<" character in ${where}`);
  }
  out = out.replace(/@import\b[^;]*;?/gi, () => {
    removed.push(`@import in ${where}`);
    return "";
  });
  // Drop any declaration chunk (split on ; { } outside parens/quotes) that matches a bad pattern.
  return out.replace(/(?:[^;{}()"']|\([^)]*\)|"[^"]*"|'[^']*'|[()"'])+/g, (chunk) => {
    const hit = BAD_CSS.exec(cssNorm(chunk));
    if (!hit) return chunk;
    removed.push(`${hit[0]} in ${where}`);
    return "";
  });
}

export function cleanPage(html: string, css: string): { html: string; css: string; removed: string[] } {
  const removed: string[] = [];
  const allowedTags = new Set(TAGS);

  const clean = sanitizeHtml(html, {
    allowedTags: TAGS,
    allowedAttributes: {
      "*": GLOBAL_ATTRS,
      ...Object.fromEntries(Object.entries(TAG_ATTRS).map(([t, a]) => [t, a])),
    },
    allowedSchemes: SCHEMES,
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com", "www.google.com"],
    disallowedTagsMode: "discard",
    transformTags: {
      "*": (tagName, attribs) => {
        const tag = tagName.toLowerCase();
        if (!allowedTags.has(tag)) {
          removed.push(`${tag} tag`);
          return { tagName, attribs: {} };
        }
        const ok = new Set([...GLOBAL_ATTRS, ...(TAG_ATTRS[tag] ?? [])]);
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) {
          const name = k.toLowerCase();
          if (!ok.has(name)) {
            removed.push(`${name} attribute on ${tag}`);
          } else if (URL_ATTRS.has(name) && !urlAllowed(v)) {
            removed.push(`unsafe ${name} URL on ${tag}`);
          } else if (name === "style") {
            const s = cleanCss(v, removed, `style attribute on ${tag}`);
            if (s.trim()) out.style = s;
          } else out[name] = v;
        }
        if (tag === "a" && out.target) out.rel = "noopener noreferrer";
        return { tagName, attribs: out };
      },
    },
    exclusiveFilter: (f) => {
      if (f.tag !== "iframe") return false;
      const ok = IFRAME_PREFIXES.some((p) => (f.attribs.src ?? "").startsWith(p));
      if (!ok) removed.push("iframe with disallowed src");
      return !ok;
    },
  });

  return { html: clean, css: cleanCss(css, removed, "css"), removed };
}
