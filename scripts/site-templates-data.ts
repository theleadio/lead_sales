import { BASE_CSS } from "./site-templates-base-css.ts";

// The three starter funnel templates (payload shape of templateSchema in
// lib/sites/admin.ts). Laid out like LEAD's live course pages (hero, what you
// will learn, schedule, FAQ, footer with the privacy link) but every piece of
// copy is a visible "[placeholder]": no real testimonials, stats or prices.

const P = "[placeholder]";
const sec = (inner: string, extra = "") =>
  `<section class="lead-section${extra}"><div class="lead-row"><div class="lead-column">${inner}</div></div></section>`;
const h = (t: string) => `<h2 class="lead-heading">${t}</h2>`;
const sub = (t: string) => `<h3 class="lead-subheading">${t}</h3>`;
const p = (t: string) => `<p class="lead-paragraph">${t}</p>`;
const btn = (label: string, href: string) => `<a class="lead-button" href="${href}">${label}</a>`;
const list = (...items: string[]) => `<ul class="lead-bullet-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const faq = (n: number) =>
  `<div class="lead-faq" data-lead="faq">${Array.from(
    { length: n },
    (_, i) => `<div class="lead-faq-item"><h4 class="lead-faq-q">Question ${i + 1} ${P}</h4><p class="lead-faq-a">Answer ${i + 1} ${P}</p></div>`,
  ).join("")}</div>`;
const form = (id: string, settings: object) =>
  `<div class="lead-form" data-lead="form" data-id="${id}" data-settings='${JSON.stringify(settings)}'></div>`;
const footer = `<section class="lead-section lead-footer"><div class="lead-row"><div class="lead-column"><p class="lead-paragraph">Company name and address ${P}</p><p class="lead-paragraph"><a href="https://example.com/privacy">Privacy policy (link ${P})</a></p></div></div></section>`;

const hero = (title: string, subtitle: string, cta: string) =>
  sec(h(`${title} ${P}`) + sub(`${subtitle} ${P}`) + btn(cta, "#form"), " lead-hero");
const learn = sec(h(`What you will learn ${P}`) + list(`First outcome ${P}`, `Second outcome ${P}`, `Third outcome ${P}`));
const schedule = sec(h(`Schedule ${P}`) + p(`Date, time and place ${P}`));
const thanks = (title: string) => sec(h(`${title} ${P}`) + p(`What happens next ${P}`));

const FOOT_CSS = `.lead-hero{background:#f5f5f7}.lead-footer{background:#0a0a0a;color:#ffffff}.lead-footer a{color:#fbe33b}\n`;
const css = BASE_CSS + FOOT_CSS;
const step = (name: string, kind: "page" | "checkout" | "thank_you", suffix: string, html: string) => ({
  name,
  kind,
  suffix,
  project: {},
  html,
  css,
});

const interest = (name: string) => ({
  type: "interest",
  formName: `${name} ${P}`,
  fields: [],
  createDeal: false,
  after: { kind: "message", text: `Thanks! ${P}` },
});

// Counts as a workshop sign-up form (Home's Free workshops). The date is a
// visible placeholder: seed day + 30, KL time.
const workshop = (name: string) => ({
  type: "workshop",
  workshop: {
    title: `Workshop title ${P}`,
    date: new Date(Date.now() + 30 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }),
    language: "en",
  },
  formName: `${name} ${P}`,
  fields: [],
  createDeal: false,
  after: { kind: "message", text: `Thanks! ${P}` },
});

export const TEMPLATES: { name: string; steps: ReturnType<typeof step>[] }[] = [
  {
    name: "Workshop sign-up",
    steps: [
      step(
        "Home",
        "page",
        "",
        hero("Workshop title", "One line on who it is for", "Save my seat") +
          learn +
          schedule +
          sec(h("Sign up") + form("f-workshop", workshop("Workshop sign-up"))) +
          sec(h("Questions") + faq(3)) +
          footer,
      ),
      step("Thank You", "thank_you", "/thank-you", thanks("You are in") + footer),
    ],
  },
  {
    name: "Paid course",
    steps: [
      step(
        "Home",
        "page",
        "",
        hero("Course title", "One line on the outcome", "See the next class") +
          learn +
          schedule +
          sec(h("Questions") + faq(3)) +
          sec(`<a class="lead-button lead-register-button" href="/payment">Register now</a>`) +
          footer,
      ),
      step(
        "Payment Form",
        "checkout",
        "/payment",
        sec(h("Register") + `<div class="lead-order-form" data-lead="order" data-id="o-course" data-settings='{"classCode":"","askCompany":false}'></div>`) +
          footer,
      ),
      step("Thank You", "thank_you", "/thank-you", thanks("Thank you for registering") + footer),
    ],
  },
  {
    name: "Lead magnet",
    steps: [
      step(
        "Home",
        "page",
        "",
        hero("Free guide title", "One line on what they get", "Send me the guide") +
          sec(h(`Inside the guide ${P}`) + list(`First thing ${P}`, `Second thing ${P}`, `Third thing ${P}`)) +
          sec(h("Get it now") + form("f-magnet", interest("Lead magnet"))) +
          footer,
      ),
      step("Thank You", "thank_you", "/thank-you", thanks("Your guide is on its way") + footer),
    ],
  },
];
