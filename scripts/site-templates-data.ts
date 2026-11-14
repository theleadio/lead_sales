// The three starter funnel templates (payload shape of templateSchema in
// lib/sites/admin.ts): v2 pages built from the sections library. Every piece of
// copy is a visible "[placeholder]"; no real testimonials, stats or prices.
import { makeElement } from "../lib/sites/editor-state.ts";
import { libraryEntry, thankYouSection } from "../lib/sites/library.ts";
import type { Element, Page, Section } from "../lib/sites/tree.ts";

const P = "[placeholder]";
const lib = (id: string): Section => libraryEntry(id).build();

type Edit = (e: Element) => Element | null; // null drops the element
const edit = (s: Section, f: Edit): Section => ({
  ...s,
  rows: s.rows.map((r) => ({ ...r, cols: r.cols.map((c) => ({ ...c, els: c.els.flatMap((e) => f(e) ?? []) })) })),
});
const props = (e: Element, p: Record<string, unknown>): Element => ({ ...e, props: { ...(e.props as object), ...p } });

const page = (...sections: Section[]): Page => ({ version: 2, sections, popups: [] });
const step = (name: string, kind: "page" | "checkout" | "thank_you", suffix: string, project: Page) => ({ name, kind, suffix, project });

// Sample date: 30 days out, KL time (publish refuses a past workshop date).
const sampleDate = () => new Date(Date.now() + 30 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
const after = { kind: "message" as const, text: `${P} Thank-you message` };
const interest = (name: string) => ({ type: "interest" as const, formName: `${name} ${P}`, fields: [], createDeal: false, after });
const workshop = (name: string) => ({
  type: "workshop" as const,
  workshop: { title: `${P} Workshop title`, date: sampleDate(), language: "en" as const },
  formName: `${name} ${P}`,
  fields: [],
  createDeal: false,
  after,
});

// Hero buttons: "form" scrolls to the page's form, "next" goes to the next step.
const heroes = (s: Section, action: "form" | "next") => edit(s, (e) => (e.type === "button" ? props(e, { action }) : e));
const withForm = (s: Section, settings: object) => edit(s, (e) => (e.type === "form" ? props(e, { settings }) : e));

export const TEMPLATES: { name: string; steps: ReturnType<typeof step>[] }[] = [
  {
    name: "Workshop sign-up",
    steps: [
      step("Home", "page", "", page(
        heroes(lib("hero-split"), "form"),
        lib("course-details"),
        lib("trainer"),
        withForm(lib("signup"), workshop("Workshop sign-up")),
        lib("faqs"),
        lib("footer"),
      )),
    ],
  },
  {
    name: "Paid course",
    steps: [
      step("Home", "page", "", page(
        heroes(lib("hero-centered"), "next"),
        lib("for-who"),
        lib("course-details"),
        lib("trainer"),
        lib("testimonials"),
        lib("pricing"),
        lib("faqs"),
        lib("footer"),
      )),
      step("Payment Form", "checkout", "/payment", page(
        edit(lib("signup"), (e) => {
          if (e.type === "form") return { ...makeElement("order"), props: { ...(makeElement("order").props as object), button: `${P} Pay now` } };
          if (e.type === "headline") return props(e, { text: `${P} Register` });
          return e;
        }),
        lib("footer"),
      )),
      step("Thank You", "thank_you", "/thank-you", page(thankYouSection("Thank you for registering", "What happens next"), lib("footer"))),
    ],
  },
  {
    name: "Lead magnet",
    steps: [
      step("Home", "page", "", page(
        heroes(lib("hero-split"), "form"),
        lib("for-who"),
        withForm(lib("signup"), interest("Lead magnet")),
        lib("footer"),
      )),
      step("Thank You", "thank_you", "/thank-you", page(thankYouSection("Your guide is on its way", "What to do next"), lib("footer"))),
    ],
  },
];
