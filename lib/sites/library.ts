// Prebuilt sections (spec §6). Client-safe: plain trees from the editor-state
// makers, no node APIs. Every string of copy is a visible "[placeholder]" -
// nothing here is a real name, quote, price, date or number. Marketing replaces
// the copy by hand. build() returns a fresh tree with fresh ids on every call.
import { makeColumn, makeElement, makeRow, makeSection } from "./editor-state.ts";
import type { Column, Element, ElementType, Preset, R, Section } from "./tree.ts";

export type LibraryEntry = { id: string; category: string; name: string; build: () => Section };

const NAVY = "#0f172a";
const INK = "#111827";
const SOFT = "#f8fafc";
const GOLD = "#facc15";
const MUTE = "#cbd5e1";
const r = (d: number, m?: number): R => ({ d, m });

type Box = Partial<Element["box"]>;
const el = (type: ElementType, props: Record<string, unknown> = {}, box: Box = {}): Element => {
  const e = makeElement(type);
  return { ...e, props: { ...(e.props as object), ...props }, box: { ...e.box, ...box } };
};
const head = (text: string, o: Record<string, unknown> = {}) =>
  el("headline", { text, size: r(44, 30), color: INK, ...o });
const eyebrow = (text: string, o: Record<string, unknown> = {}) =>
  el("sub", { text, size: r(14), weight: 700, color: "#b45309", ...o }, { mb: 4 });
const para = (text: string, o: Record<string, unknown> = {}) => el("para", { text, size: r(18, 16), color: "#475569", ...o });
const btn = (text: string, o: Record<string, unknown> = {}) =>
  el("button", { text, bg: GOLD, fg: INK, size: r(18), ...o }, { mt: 8 });

const col = (els: Element[], o: Partial<Pick<Column, "bg" | "radius" | "name">> & { pad?: number } = {}): Column => {
  const { pad = 0, ...rest } = o;
  return { ...makeColumn(), ...rest, pad: { t: pad, r: pad, b: pad, l: pad }, els };
};
const row = (preset: Preset, cols: Column[], o: { valign?: "start" | "center" | "end"; gap?: number } = {}) => ({
  ...makeRow(preset),
  valign: o.valign ?? "start",
  gap: r(o.gap ?? 32, 20),
  cols,
});
const section = (name: string, bg: string, rows: ReturnType<typeof row>[], o: { width?: Section["width"]; pt?: number; pb?: number } = {}): Section => ({
  ...makeSection(o.width ?? "wide"),
  name,
  bg,
  pt: r(o.pt ?? 88, 56),
  pb: r(o.pb ?? 88, 56),
  rows,
});

// Dark-section colours for the element helpers above.
const onDark = { color: "#ffffff" };
const onDarkMute = { color: MUTE };

const photo = (alt: string) => el("image", { alt }, { radius: 16 });

// 30 days from build time, KL wall clock. Placeholder data, not a real date.
const inThirtyDays = () =>
  `${new Date(Date.now() + 30 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })}T09:00`;

const card = (els: Element[], bg = "#ffffff") => col(els, { bg, radius: 18, pad: 28 });

export const LIBRARY: LibraryEntry[] = [
  {
    id: "hero-split",
    category: "Hero",
    name: "Hero · Split",
    build: () =>
      section("Hero · Split", NAVY, [
        row("2/3+1/3", [
          col([
            eyebrow("[placeholder] Workshop or course label", { color: GOLD }),
            head("[placeholder] Course title that states the outcome", { ...onDark, size: r(54, 34) }),
            para("[placeholder] One or two lines on who this is for and what changes for them.", onDarkMute),
            btn("[placeholder] Reserve my seat"),
          ]),
          col([photo("[placeholder] Trainer or course photo")]),
        ], { valign: "center", gap: 48 }),
      ], { pt: 112, pb: 112 }),
  },
  {
    id: "hero-centered",
    category: "Hero",
    name: "Hero · Centered",
    build: () =>
      section("Hero · Centered", SOFT, [
        row("1", [
          col([
            eyebrow("[placeholder] Workshop or course label", { align: "center" }),
            head("[placeholder] Course title that states the outcome", { align: "center", size: r(58, 34) }),
            para("[placeholder] One or two lines on who this is for and what changes for them.", { align: "center" }),
            btn("[placeholder] Reserve my seat", { align: "center" }),
            para("[placeholder] Date, time and venue", { align: "center", size: r(15), color: "#64748b" }),
          ]),
        ]),
      ], { width: "medium", pt: 120, pb: 104 }),
  },
  {
    id: "cta",
    category: "Call to action",
    name: "Call to action",
    build: () =>
      section("Call to action", GOLD, [
        row("1", [
          col([
            head("[placeholder] A short line that makes the next step obvious", { align: "center", size: r(38, 28) }),
            para("[placeholder] One sentence on what happens when they click.", { align: "center", color: "#422006" }),
            btn("[placeholder] Reserve my seat", { align: "center", bg: INK, fg: "#ffffff" }),
          ]),
        ]),
      ], { width: "medium", pt: 72, pb: 72 }),
  },
  {
    id: "for-who",
    category: "For who",
    name: "For who",
    build: () =>
      section("For who", "#ffffff", [
        row("1", [col([eyebrow("[placeholder] Is this for you?", { align: "center" }), head("[placeholder] Who this is for", { align: "center" })])], { gap: 0 }),
        row("3", ["one", "two", "three"].map((n) =>
          card([
            el("icon-text", { icon: "check", text: `<b>[placeholder] Audience ${n}</b>`, size: r(20), color: INK }),
            para("[placeholder] Describe the situation this person is in and what they want to change.", { size: r(16) }),
          ], SOFT)), { gap: 24 }),
      ]),
  },
  {
    id: "course-details",
    category: "Course details",
    name: "Course details",
    build: () =>
      section("Course details", SOFT, [
        row("1", [col([head("[placeholder] What you will learn", { align: "center" })])], { gap: 0 }),
        row("2", [
          col([
            el("list", { items: ["[placeholder] First outcome", "[placeholder] Second outcome", "[placeholder] Third outcome", "[placeholder] Fourth outcome"], size: r(19, 17), color: INK }),
          ]),
          card([
            el("sub", { text: "[placeholder] Course details", size: r(20), color: INK }),
            el("icon-text", { icon: "calendar", text: "[placeholder] Date", color: INK }),
            el("icon-text", { icon: "clock", text: "[placeholder] Time", color: INK }),
            el("icon-text", { icon: "pin", text: "[placeholder] Venue", color: INK }),
            el("icon-text", { icon: "gift", text: "[placeholder] What is included", color: INK }),
          ]),
        ], { valign: "center", gap: 48 }),
      ]),
  },
  {
    id: "trainer",
    category: "Trainer",
    name: "Trainer",
    build: () =>
      section("Trainer", "#ffffff", [
        row("1/3+2/3", [
          col([photo("[placeholder] Trainer photo")]),
          col([
            eyebrow("[placeholder] Your trainer"),
            head("[placeholder] Trainer name", { size: r(40, 30) }),
            para("[placeholder] A short bio: background, and why they teach this."),
            el("list", { items: ["[placeholder] Credential or experience one", "[placeholder] Credential or experience two", "[placeholder] Credential or experience three"], color: INK }),
          ]),
        ], { valign: "center", gap: 56 }),
      ]),
  },
  {
    id: "testimonials",
    category: "Testimonials",
    name: "Testimonials",
    build: () =>
      section("Testimonials", INK, [
        row("1", [col([head("[placeholder] What attendees say", { ...onDark, align: "center" })])], { gap: 0 }),
        row("3", [1, 2, 3].map(() =>
          col([
            el("headline", { text: "“", size: r(56), color: GOLD, font: "hf" }, { mb: -16 }),
            para("[placeholder — paste a real attendee quote with their permission]", { color: "#e5e7eb", size: r(17) }),
            para("[placeholder] Attendee name and role, used with permission", { color: "#94a3b8", size: r(14) }),
          ], { bg: "#1f2937", radius: 18, pad: 28 })), { gap: 24 }),
      ]),
  },
  {
    id: "pricing",
    category: "Pricing",
    name: "Pricing",
    build: () =>
      section("Pricing", SOFT, [
        row("1", [
          col([
            eyebrow("[placeholder] Package name", { align: "center" }),
            head("RM [placeholder]", { align: "center", size: r(64, 44) }),
            para("[placeholder] What the price covers", { align: "center", size: r(16) }),
            el("divider", {}, { mt: 8, mb: 8 }),
            el("list", { items: ["[placeholder] What is included one", "[placeholder] What is included two", "[placeholder] What is included three"], color: INK }),
            btn("[placeholder] Register now", { action: "next", full: true, bg: INK, fg: "#ffffff" }),
          ], { bg: "#ffffff", radius: 22, pad: 36 }),
        ]),
      ], { width: "small" }),
  },
  {
    id: "faqs",
    category: "FAQs",
    name: "FAQs",
    build: () =>
      section("FAQs", "#ffffff", [
        row("1", [
          col([
            head("[placeholder] Frequently asked questions", { align: "center" }),
            el("faq", { items: [1, 2, 3, 4].map((n) => [`[placeholder] Question ${n}`, `[placeholder] Answer ${n}`]) }, { mt: 16 }),
          ]),
        ]),
      ], { width: "medium" }),
  },
  {
    id: "signup",
    category: "Sign-up form",
    name: "Sign-up form",
    build: () =>
      section("Sign-up form", "#eef2f7", [
        row("1", [
          col([
            head("[placeholder] Save your seat", { align: "center", size: r(38, 28) }),
            para("[placeholder] One line on what happens after they sign up.", { align: "center", size: r(17) }),
            el("form", { button: "[placeholder] Save my seat" }, { mt: 12 }),
          ]),
        ]),
      ], { width: "small" }),
  },
  {
    id: "countdown",
    category: "Countdown",
    name: "Countdown",
    build: () =>
      section("Countdown", NAVY, [
        row("1", [
          col([
            eyebrow("[placeholder] Registration closes in", { align: "center", color: GOLD }),
            el("countdown", { to: inThirtyDays(), doneText: "[placeholder] Registration is closed" }),
            para("[placeholder] The date shown is sample data: set the real one.", { align: "center", size: r(14), color: "#94a3b8" }),
          ]),
        ]),
      ], { width: "medium", pt: 64, pb: 64 }),
  },
  {
    id: "footer",
    category: "Footer",
    name: "Footer",
    build: () =>
      section("Footer", "#0b1220", [
        row("2", [
          col([para("[placeholder] Company name and address", { color: "#94a3b8", size: r(14) })]),
          col([el("nav", { items: [{ label: "[placeholder] Privacy policy", href: "/privacy" }], align: "right", color: MUTE })]),
        ], { valign: "center" }),
      ], { pt: 40, pb: 40 }),
  },
];

export const libraryEntry = (id: string): LibraryEntry => {
  const e = LIBRARY.find((x) => x.id === id);
  if (!e) throw new Error(`No library section ${id}`);
  return e;
};
export const LIBRARY_CATEGORIES = (): string[] => [...new Set(LIBRARY.map((l) => l.category))];
