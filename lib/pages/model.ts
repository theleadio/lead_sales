import { z } from "zod";

// A landing page's blocks. Every field is plain text with a length limit:
// nothing a staff member types is ever rendered as HTML. Lists (testimonials,
// FAQ) are typed one per line as "first part | second part".

const t = (max: number) => z.string().trim().max(max).default("");
const req = (max: number, msg: string) =>
  z.string().trim().min(1, msg).max(max);

const isHttps = (v: string) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};
const HTTPS = "Use a link that starts with https://";
const httpsUrl = z.string().trim().max(500).refine(isHttps, HTTPS);
const optUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || isHttps(v), HTTPS)
  .default("");
// A button goes to another site, or down to this page's form.
const link = (required: boolean) =>
  z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => (v === "" ? !required : v === "#form" || isHttps(v)),
      "Use a link that starts with https://, or #form for this page's form",
    );

export function youtubeId(url: string): string | null {
  return (
    url.match(
      /^https:\/\/(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/,
    )?.[1] ?? null
  );
}

const code = z
  .string()
  .trim()
  .max(50)
  .regex(/^[A-Za-z0-9_-]*$/, "Letters, digits, - and _ only")
  .default("");

export const blockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hero"),
    heading: req(120, "A heading is required"),
    sub: t(300),
    imageUrl: optUrl,
    ctaLabel: t(40),
    ctaHref: link(false).default(""),
  }),
  z.object({
    kind: z.literal("text"),
    heading: t(120),
    body: req(5000, "Some text is required"),
  }),
  z.object({ kind: z.literal("image"), url: httpsUrl, alt: t(200) }),
  z.object({
    kind: z.literal("video"),
    url: z
      .string()
      .trim()
      .max(500)
      .refine((v) => youtubeId(v) !== null, "Use a YouTube link"),
  }),
  z.object({
    kind: z.literal("testimonials"),
    heading: t(120),
    lines: req(5000, "At least one line is required"),
  }),
  z.object({
    kind: z.literal("faq"),
    heading: t(120),
    lines: req(8000, "At least one line is required"),
  }),
  z.object({
    kind: z.literal("form"),
    heading: t(120),
    buttonLabel: t(40),
    // The lead's form_name, for attribution. Empty: "page:<slug>".
    formName: t(200),
    courseInterest: code,
    classCode: code,
  }),
  z.object({
    kind: z.literal("button"),
    label: req(40, "A label is required"),
    href: link(true),
  }),
]);
export type Block = z.output<typeof blockSchema>;
export type BlockKind = Block["kind"];

export const blocksSchema = z.array(blockSchema).max(40);

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*){0,3}$/;

export const pageSchema = z.object({
  title: req(120, "A title is required"),
  slug: z
    .string()
    .trim()
    .max(120)
    .regex(
      SLUG,
      "Lower-case letters, digits and hyphens, e.g. ai-engineering or cn/workshop",
    ),
  description: t(300),
  language: z.enum(["en", "zh"]),
  blocks: blocksSchema,
});
export type PageInput = z.output<typeof pageSchema>;

// "a | b" per line, for testimonials (quote | name) and FAQ (question | answer).
export function pairs(lines: string): [string, string][] {
  return lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    });
}

// What the editor shows for each kind of block.
type Field = {
  name: string;
  label: string;
  area?: boolean;
  hint?: string;
  // An image link: the editor offers an upload that fills it in.
  image?: boolean;
};
export const BLOCKS: Record<BlockKind, { label: string; fields: Field[] }> = {
  hero: {
    label: "Hero",
    fields: [
      { name: "heading", label: "Heading" },
      { name: "sub", label: "Line under the heading", area: true },
      { name: "imageUrl", label: "Image", image: true },
      { name: "ctaLabel", label: "Button label" },
      {
        name: "ctaHref",
        label: "Button link",
        hint: "https://… or #form to jump to this page's form",
      },
    ],
  },
  text: {
    label: "Text",
    fields: [
      { name: "heading", label: "Heading" },
      {
        name: "body",
        label: "Text",
        area: true,
        hint: "A blank line starts a new paragraph.",
      },
    ],
  },
  image: {
    label: "Image",
    fields: [
      { name: "url", label: "Image", image: true },
      { name: "alt", label: "What the image shows (for screen readers)" },
    ],
  },
  video: {
    label: "Video",
    fields: [{ name: "url", label: "YouTube link" }],
  },
  testimonials: {
    label: "Testimonials",
    fields: [
      { name: "heading", label: "Heading" },
      {
        name: "lines",
        label: "Testimonials",
        area: true,
        hint: "One per line: what they said | their name. Real ones only.",
      },
    ],
  },
  faq: {
    label: "FAQ",
    fields: [
      { name: "heading", label: "Heading" },
      {
        name: "lines",
        label: "Questions",
        area: true,
        hint: "One per line: question | answer",
      },
    ],
  },
  form: {
    label: "Lead form",
    fields: [
      { name: "heading", label: "Heading" },
      { name: "buttonLabel", label: "Button label" },
      {
        name: "formName",
        label: "Form name in reports",
        hint: "Keep the SalesProcess form's name so reports continue. Empty: page:<address>.",
      },
      { name: "courseInterest", label: "Course code (optional)" },
      { name: "classCode", label: "Class code (optional)" },
    ],
  },
  button: {
    label: "Button",
    fields: [
      { name: "label", label: "Label" },
      {
        name: "href",
        label: "Link",
        hint: "e.g. the CRM registration link of a class, or #form",
      },
    ],
  },
};
export const BLOCK_KINDS = Object.keys(BLOCKS) as BlockKind[];
