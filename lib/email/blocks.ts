import { z } from "zod";

// The email editor's blocks, and how they become email HTML. Pure and free
// of Node-only imports, so the browser uses the same code for the live
// preview that the server uses to save and send.
//
// Every value is escaped here, links must be https (or mailto), and the
// server still runs the result through cleanBody (lib/email/campaign.ts), so
// the styles used below must stay inside that allowlist.

export const MAX_BLOCKS = 100;

const linkOrMail = z
  .string()
  .trim()
  .max(2000)
  .regex(
    /^(https:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/,
    "Links must start with https:// or mailto:",
  );
const align = z.enum(["left", "center"]);
const id = z.string().max(40);

export const BUTTON_COLORS = {
  charcoal: { bg: "#3d3d3d", fg: "#ffffff", label: "Charcoal" },
  yellow: { bg: "#fbe33b", fg: "#0a0a0a", label: "LEAD yellow" },
  blue: { bg: "#2c5674", fg: "#ffffff", label: "Deep blue" },
} as const;
export type ButtonColor = keyof typeof BUTTON_COLORS;

export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    id,
    type: z.literal("heading"),
    text: z.string().max(300),
    align,
  }),
  z.object({
    id,
    type: z.literal("text"),
    text: z.string().max(10000),
    align,
  }),
  z.object({
    id,
    type: z.literal("image"),
    url: z
      .string()
      .trim()
      .max(2000)
      .regex(
        /^https:\/\/[^\s"'<>]+$/,
        "Choose an image from the library, or paste an https:// address",
      ),
    alt: z.string().max(300),
    href: z.union([z.literal(""), linkOrMail]),
  }),
  z.object({
    id,
    type: z.literal("button"),
    label: z.string().trim().min(1, "A button needs a label").max(80),
    href: linkOrMail,
    align,
    color: z.enum(["charcoal", "yellow", "blue"]),
  }),
  z.object({ id, type: z.literal("divider") }),
]);
export const blocksSchema = z.array(blockSchema).max(MAX_BLOCKS);

export type Block = z.infer<typeof blockSchema>;

// What is wrong with a block, in words for the editor, or null.
export function blockProblem(b: Block): string | null {
  const p = blockSchema.safeParse(b);
  return p.success ? null : (p.error.issues[0]?.message ?? "Not complete.");
}
export type BlockType = Block["type"];

export const BLOCK_LABEL: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  image: "Image",
  button: "Button",
  divider: "Divider",
};

const newId = () => Math.random().toString(36).slice(2, 10);

// A fresh block of a type, with starting words that show what it is for.
export function newBlock(type: BlockType): Block {
  switch (type) {
    case "heading":
      return { id: newId(), type, text: "A clear headline", align: "left" };
    case "text":
      return {
        id: newId(),
        type,
        text: "Hi {{name}},\n\nWrite your message here.",
        align: "left",
      };
    case "image":
      return { id: newId(), type, url: "", alt: "", href: "" };
    case "button":
      return {
        id: newId(),
        type,
        label: "Register now",
        href: "https://ai.thelead.io",
        align: "left",
        color: "charcoal",
      };
    case "divider":
      return { id: newId(), type };
  }
}

// What a new campaign starts with.
export const STARTER_BLOCKS = (): Block[] => [
  newBlock("heading"),
  newBlock("text"),
  newBlock("button"),
];

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Text blocks take two marks: **bold** and [words](https://link). Everything
// else is plain text. The text is escaped first, so a mark can't smuggle in
// HTML; a link that isn't https or mailto stays as plain text.
export function inlineMarkup(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(
    /\[([^\]\n]+)\]\(((?:https:\/\/|mailto:)[^\s()"<>]+)\)/g,
    '<a href="$2" style="color:#2c5674">$1</a>',
  );
  return s.replace(/\n/g, "<br />");
}

const alignStyle = (a: "left" | "center") =>
  a === "center" ? "text-align:center;" : "";

// One block as email HTML.
export function renderBlock(b: Block): string {
  switch (b.type) {
    case "heading":
      return b.text.trim()
        ? `<h2 style="${alignStyle(b.align)}font-size:24px;line-height:1.3;margin:0 0 16px">${escapeHtml(b.text)}</h2>`
        : "";
    case "text":
      return b.text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(
          (p) =>
            `<p style="${alignStyle(b.align)}margin:0 0 16px">${inlineMarkup(p)}</p>`,
        )
        .join("");
    case "image": {
      if (!b.url) return "";
      const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt)}" style="display:block;max-width:100%;height:auto;border-radius:8px" />`;
      return `<div style="margin:0 0 16px">${b.href ? `<a href="${escapeHtml(b.href)}">${img}</a>` : img}</div>`;
    }
    case "button": {
      const c = BUTTON_COLORS[b.color];
      return (
        `<div style="${alignStyle(b.align)}margin:8px 0 24px">` +
        `<a href="${escapeHtml(b.href)}" style="display:inline-block;background-color:${c.bg};color:${c.fg};padding:12px 22px;border-radius:8px;font-weight:600;text-decoration:none">${escapeHtml(b.label)}</a>` +
        `</div>`
      );
    }
    case "divider":
      return `<hr style="border:none;border-top:1px solid #e5e5ea;margin:24px 0" />`;
  }
}

export function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join("\n");
}

// The unsubscribe footer, in the email's language.
export const FOOTER: Record<"en" | "zh", { why: string; link: string }> = {
  en: {
    why: "You are receiving this because you agreed to hear from LEAD.",
    link: "Unsubscribe",
  },
  zh: { why: "您收到此邮件是因为您同意接收 LEAD 的资讯。", link: "退订" },
};

// The frame every campaign is sent in, with the unsubscribe footer. Shared
// by the sender and the editor preview so the preview is what people get.
export function wrapEmail(
  bodyHtml: string,
  footer: { why: string; link: string; url: string },
): string {
  return (
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1d1d1f">${bodyHtml}` +
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px">` +
    `<p style="font-size:12px;color:#6e6e73">${footer.why} <a href="${escapeHtml(footer.url)}">${footer.link}</a></p></div>`
  );
}
