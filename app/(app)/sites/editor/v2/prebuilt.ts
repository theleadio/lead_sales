// Prebuilt sections shown in Add > Prebuilt sections.
// STUB until Task 7 (lib/sites/library.ts): Task 7 only has to fill this one
// array (or re-export its own list here). Copy must stay visibly [placeholder].
import type { Section } from "@/lib/sites/tree";
import { makeColumn, makeRow } from "@/lib/sites/editor-state";
import { newElement, newSection } from "./insert";

export type Prebuilt = { category: string; name: string; build: () => Section };

const text = (type: "headline" | "para" | "sub", t: string, extra: Record<string, unknown> = {}) => {
  const e = newElement(type);
  return { ...e, props: { ...(e.props as object), text: t, ...extra } };
};

export const PREBUILT: Prebuilt[] = [
  {
    category: "Hero",
    name: "Hero",
    build: () => {
      const s = newSection("wide");
      const row = { ...makeRow("1"), cols: [{ ...makeColumn(), els: [text("headline", "[Course title]"), text("para", "[One line on who it is for]"), newElement("button")] }] };
      return { ...s, name: "Hero", rows: [row] };
    },
  },
  {
    category: "FAQs",
    name: "FAQ",
    build: () => {
      const s = newSection("medium");
      const row = { ...makeRow("1"), cols: [{ ...makeColumn(), els: [text("headline", "[FAQs]", { align: "center" }), newElement("faq")] }] };
      return { ...s, name: "FAQ", rows: [row] };
    },
  },
  {
    category: "Sign-up form",
    name: "Sign-up form",
    build: () => {
      const s = newSection("small");
      const row = { ...makeRow("1"), cols: [{ ...makeColumn(), els: [text("headline", "[Register]", { align: "center" }), newElement("form")] }] };
      return { ...s, name: "Sign-up form", bg: "#f8fafc", rows: [row] };
    },
  },
];
export const PREBUILT_CATEGORIES = () => [...new Set(PREBUILT.map((p) => p.category))];
