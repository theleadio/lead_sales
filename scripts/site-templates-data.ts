// The starter funnel templates (payload shape of templateSchema in
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

// ---- LEAD look --------------------------------------------------------------
// The library's neutral palette swapped for LEAD's brand colours (app/globals.css:
// ink #0a0a0a, charcoal #3d3d3d, LEAD yellow #fbe33b, LEAD blue #a1bace, soft
// grey #f5f5f7). Dark text always sits on the yellow and the blue (white on
// either fails WCAG AA). Fonts stay the theme's Inter.
export const LEAD_COLORS: Record<string, string> = {
  "#0f172a": "#0a0a0a", // navy hero / countdown -> ink
  "#111827": "#0a0a0a", // ink text, dark buttons, testimonials -> ink
  "#facc15": "#fbe33b", // gold -> LEAD yellow
  "#f8fafc": "#f5f5f7", // soft section -> LEAD soft grey
  "#eef2f7": "#e8eff5", // sign-up band -> pale LEAD blue
  "#b45309": "#3d3d3d", // eyebrow amber -> charcoal
  "#1f2937": "#1c1c1e", // testimonial card -> near-ink
  "#0b1220": "#0a0a0a", // footer -> ink
  "#422006": "#3d3d3d", // text on yellow -> charcoal
};
export const leadLook = (sec: Section): Section =>
  JSON.parse(
    JSON.stringify(sec).replace(/"#[0-9a-fA-F]{6}"/g, (c) => {
      const to = LEAD_COLORS[c.slice(1, -1).toLowerCase()];
      return to ? `"${to}"` : c;
    }),
  );

// Rewrites the marked copy of a section, keyed by the library's text. Every
// replacement keeps its "[placeholder]" mark: these say what to write for a
// LEAD course, they don't claim anything.
const retext = (sec: Section, map: Record<string, string>): Section =>
  edit(sec, (e) => {
    const p = e.props as Record<string, unknown>;
    const swap = (t: unknown) => (typeof t === "string" && map[t] ? map[t] : t);
    if (typeof p.text === "string") return props(e, { text: swap(p.text) });
    if (Array.isArray(p.items) && p.items.every((x) => typeof x === "string")) return props(e, { items: (p.items as string[]).map(swap) });
    if (e.type === "form" || e.type === "order") return props(e, { button: swap(p.button) });
    return e;
  });

const lead = (id: string, map: Record<string, string> = {}) => leadLook(retext(lib(id), map));

const LEAD_FAQ = (sec: Section, qs: string[]) =>
  edit(sec, (e) => (e.type === "faq" ? props(e, { items: qs.map((q) => [`${P} ${q}`, `${P} Answer`]) }) : e));

const leadFooter = () => lead("footer", { "[placeholder] Company name and address": `${P} LEAD's company name, registration number and address` });

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
  {
    name: "LEAD · AI bootcamp (paid)",
    steps: [
      step("Home", "page", "", page(
        heroes(lead("hero-split", {
          "[placeholder] Workshop or course label": `${P} Bootcamp name and format (e.g. 2-day, in person)`,
          "[placeholder] Course title that states the outcome": `${P} The skill they leave with, in one line`,
          "[placeholder] One or two lines on who this is for and what changes for them.": `${P} Who it is for (role or industry) and what they can do after it`,
          "[placeholder] Reserve my seat": `${P} See dates and fees`,
          "[placeholder] Trainer or course photo": `${P} Photo from a past LEAD class`,
        }), "next"),
        lead("for-who", {
          "[placeholder] Is this for you?": `${P} Is this bootcamp for you?`,
          "[placeholder] Who this is for": `${P} Built for people who…`,
        }),
        lead("course-details", {
          "[placeholder] What you will learn": `${P} What you will be able to do`,
          "[placeholder] What is included": `${P} What is included (materials, certificate, follow-up)`,
        }),
        lead("trainer"),
        lead("testimonials", { "[placeholder] What attendees say": `${P} What past LEAD participants say` }),
        lead("pricing", { "[placeholder] What the price covers": `${P} What the fee covers, and HRDC claimability if it applies` }),
        lead("countdown"),
        LEAD_FAQ(lead("faqs"), [
          "Do I need any experience?",
          "Is it claimable under HRDC?",
          "What do I need to bring?",
          "Can I get a refund or change my date?",
          "Will I get a certificate?",
        ]),
        leadFooter(),
      )),
      step("Payment Form", "checkout", "/payment", page(
        leadLook(edit(lib("signup"), (e) => {
          if (e.type === "form") return { ...makeElement("order"), props: { ...(makeElement("order").props as object), button: `${P} Pay now` } };
          if (e.type === "headline") return props(e, { text: `${P} Confirm your seat` });
          if (e.type === "para") return props(e, { text: `${P} One line on payment options (card, FPX) and what happens next` });
          return e;
        })),
        leadFooter(),
      )),
      step("Thank You", "thank_you", "/thank-you", page(
        leadLook(thankYouSection("You're in. See you in class", "What to expect next: confirmation email, joining details, what to prepare")),
        leadFooter(),
      )),
    ],
  },
  {
    name: "LEAD · Free webinar",
    steps: [
      step("Home", "page", "", page(
        heroes(lead("hero-centered", {
          "[placeholder] Workshop or course label": `${P} Free live webinar`,
          "[placeholder] Course title that states the outcome": `${P} The one thing they will learn, in one line`,
          "[placeholder] One or two lines on who this is for and what changes for them.": `${P} Who should join, and why now`,
          "[placeholder] Reserve my seat": `${P} Save my free seat`,
          "[placeholder] Date, time and venue": `${P} Date and time (Malaysia time), online`,
        }), "form"),
        lead("course-details", {
          "[placeholder] What you will learn": `${P} In this webinar you will`,
          "[placeholder] Venue": `${P} Where to join (Zoom link sent by email)`,
          "[placeholder] What is included": `${P} Free bonus for attendees (optional)`,
        }),
        lead("trainer", { "[placeholder] Your trainer": `${P} Your host` }),
        withForm(lead("signup", {
          "[placeholder] Save your seat": `${P} Save your free seat`,
          "[placeholder] One line on what happens after they sign up.": `${P} We will email you the joining link and a reminder`,
          "[placeholder] Save my seat": `${P} Save my free seat`,
        }), workshop("LEAD free webinar")),
        LEAD_FAQ(lead("faqs"), [
          "Is it really free?",
          "Will there be a recording?",
          "What do I need to join?",
          "Who is it for?",
        ]),
        leadFooter(),
      )),
      step("Thank You", "thank_you", "/thank-you", page(
        leadLook(thankYouSection("Your seat is saved", "Check your inbox for the joining link, and add it to your calendar")),
        leadFooter(),
      )),
    ],
  },
];
