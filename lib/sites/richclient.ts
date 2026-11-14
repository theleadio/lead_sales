// Client-side twin of richtext.ts (sanitize-html is server-only). Used by inline
// text editing: serialise the edited DOM, and sanitise pasted HTML. Keeps only
// b i u s a br, {{key}} tokens and https/mailto/tel/# links. The server
// sanitises again on save, so this is the first line of defence, not the last.
// Works on any DOM-shaped tree (real nodes, or plain objects in tests).

export type MiniNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MiniNode>;
  getAttribute?: (n: string) => string | null;
};

const KEY = /^[a-z][a-z0-9_]{1,40}$/;
const SAFE_HREF = /^(https:|mailto:|tel:|#)/i;
const SKIP = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "META", "LINK"]);
const BLOCK = new Set(["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "UL", "OL"]);

export const safeHref = (h: string | null | undefined): string | null => {
  const t = (h ?? "").trim();
  return SAFE_HREF.test(t) ? t : null;
};

export const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

/** Which allowed tag does this one become? null = not formatting (unwrap, keep the text). */
export function mapTag(name: string, style = ""): "b" | "i" | "u" | "s" | "a" | "br" | null {
  switch (name.toUpperCase()) {
    case "B":
    case "STRONG":
      // Google Docs wraps a whole paste in <b style="font-weight:normal">: that is not bold.
      return /font-weight:\s*(normal|400)/i.test(style) ? null : "b";
    case "I":
    case "EM":
      return "i";
    case "U":
    case "INS":
      return "u";
    case "S":
    case "STRIKE":
    case "DEL":
      return "s";
    case "A":
      return "a";
    case "BR":
      return "br";
    default:
      return null;
  }
}

/** Serialise a node's children to the allowed subset. Chips (data-key) become {{key}}. */
export function serialize(root: MiniNode): string {
  const walk = (n: MiniNode, out: string[]) => {
    const kids = Array.from(n.childNodes);
    kids.forEach((c, i) => {
      if (c.nodeType === 3) return void out.push(escText((c.textContent ?? "").replace(/ /g, " ")));
      if (c.nodeType !== 1) return; // comments (Word's StartFragment) and the rest
      const name = c.nodeName.toUpperCase();
      if (SKIP.has(name)) return;
      const key = c.getAttribute?.("data-key");
      if (key) return void (KEY.test(key) && out.push(`{{${key}}}`));
      const tag = mapTag(name, c.getAttribute?.("style") ?? "");
      if (tag === "br") return void out.push("<br>");
      if (tag === "a") {
        const href = safeHref(c.getAttribute?.("href"));
        if (!href) return walk(c, out);
        out.push(`<a href="${escAttr(href)}">`);
        walk(c, out);
        return void out.push("</a>");
      }
      if (tag) {
        out.push(`<${tag}>`);
        walk(c, out);
        return void out.push(`</${tag}>`);
      }
      walk(c, out);
      if (BLOCK.has(name) && i < kids.length - 1) out.push("<br>"); // paragraphs/divs end a line
    });
  };
  const out: string[] = [];
  walk(root, out);
  return out.join("");
}

/** Plain pasted text: escaped, newlines become <br>. */
export const plainToRich = (t: string) => escText(t.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");

/** Stored text -> what the editable shows: each {{key}} becomes a non-editable chip. */
export function toEditable(html: string, vals: Record<string, string>): string {
  return html.replace(/\{\{([a-z][a-z0-9_]{1,40})\}\}/g, (m, k: string) => chip(k, vals[k] ?? m));
}
export const chip = (key: string, shown: string) =>
  `<span class="mv" contenteditable="false" data-key="${key}">${escText(shown)}</span>`;
