import { counterProps, counterWrite, linkProps, linkWrite } from "./settings.ts";
import type { Ctx, Def, TraitDef } from "./types.ts";

// "Go to": #form, one of this funnel's steps (by path), or any https URL.
export const linkTraits = (ctx: Ctx): TraitDef[] => [
  {
    name: "s_link",
    label: "Goes to",
    type: "select",
    options: [
      { id: "form", name: "The form on this page (#form)" },
      ...ctx.steps.map((s) => ({ id: `step:${s.path}`, name: `Step: ${s.name}` })),
      { id: "url", name: "Another website (https)" },
    ],
  },
  { name: "s_url", label: "Website link" },
];

const faqItem = (q = "Question [placeholder]", a = "Answer [placeholder]") =>
  `<div class="lead-faq-item"><h4 class="lead-faq-q">${q}</h4><p class="lead-faq-a">${a}</p></div>`;

const social = (name: string, href: string) => `<a class="lead-social" href="${href}">${name}</a>`;

export const INTERACTIVE: Def[] = [
  {
    type: "lead-button",
    label: "Button",
    category: "Interactive",
    extend: "link",
    tag: "a",
    classes: ["lead-button"],
    attrs: () => ({ href: "#form" }),
    html: "Button",
    traits: linkTraits,
    read: (a) => linkProps(a.href),
    write: linkWrite,
  },
  {
    type: "lead-number-counter",
    label: "Number counter",
    category: "Interactive",
    tag: "div",
    classes: ["lead-counter"],
    attrs: () => ({ "data-lead": "counter", "data-settings": '{"to":100}' }),
    html: "100",
    droppable: false,
    traits: [{ name: "s_to", label: "Count up to", type: "number" }],
    read: (a) => counterProps(a["data-settings"]),
    write: counterWrite,
  },
  {
    type: "lead-social-icons",
    label: "Social icons",
    category: "Interactive",
    tag: "div",
    classes: ["lead-social-icons"],
    html:
      social("Facebook", "https://www.facebook.com/") +
      social("Instagram", "https://www.instagram.com/") +
      social("LinkedIn", "https://www.linkedin.com/"),
  },
  {
    type: "lead-faq",
    label: "FAQ",
    category: "Interactive",
    tag: "div",
    classes: ["lead-faq"],
    attrs: () => ({ "data-lead": "faq" }),
    html: faqItem() + faqItem() + faqItem(), // item = [question, ...answer]
    droppable: ".lead-faq-item",
  },
  {
    type: "lead-faq-item",
    label: "FAQ item",
    category: "Interactive",
    tag: "div",
    classes: ["lead-faq-item"],
    html: `<h4 class="lead-faq-q">Question [placeholder]</h4><p class="lead-faq-a">Answer [placeholder]</p>`,
    droppable: true,
    draggable: ".lead-faq",
  },
  {
    type: "lead-nav-menu",
    label: "Nav menu",
    category: "Interactive",
    tag: "nav",
    classes: ["lead-nav-menu"],
    html:
      `<a class="lead-nav-link" href="#form">Link one</a>` +
      `<a class="lead-nav-link" href="#form">Link two</a>` +
      `<a class="lead-nav-link" href="#form">Link three</a>`,
  },
];
