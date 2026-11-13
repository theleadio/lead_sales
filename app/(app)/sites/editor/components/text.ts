import type { Def } from "./types.ts";

export const TEXT: Def[] = [
  {
    type: "lead-heading",
    label: "Heading",
    category: "Text",
    extend: "text",
    tag: "h2",
    classes: ["lead-heading"],
    html: "Heading",
  },
  {
    type: "lead-subheading",
    label: "Sub-heading",
    category: "Text",
    extend: "text",
    tag: "h3",
    classes: ["lead-subheading"],
    html: "Sub-heading",
  },
  {
    type: "lead-paragraph",
    label: "Paragraph",
    category: "Text",
    extend: "text",
    tag: "p",
    classes: ["lead-paragraph"],
    html: "Write something here.",
  },
  {
    type: "lead-rich-text",
    label: "Rich text",
    category: "Text",
    extend: "text",
    tag: "div",
    classes: ["lead-rich-text"],
    html: "<p>Write something here. Select text to make it <strong>bold</strong> or add a link.</p>",
  },
  {
    type: "lead-bullet-list",
    label: "Bullet list",
    category: "Text",
    extend: "text",
    tag: "ul",
    classes: ["lead-bullet-list"],
    html: "<li>First point</li><li>Second point</li><li>Third point</li>",
  },
];
