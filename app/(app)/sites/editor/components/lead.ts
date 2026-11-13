import { formProps, formWrite, FORM_DEFAULT, orderProps, orderWrite, parseJson, waProps, waWrite } from "./settings.ts";
import type { Ctx, Def, TraitDef } from "./types.ts";

const formTraits = (ctx: Ctx): TraitDef[] => {
  const steps = [{ id: "", name: "Pick a step" }, ...ctx.steps.map((s) => ({ id: s.id, name: s.name }))];
  return [
    {
      name: "s_type",
      label: "Form type",
      type: "select",
      options: [
        { id: "interest", name: "Interest" },
        { id: "workshop", name: "Workshop sign-up" },
        { id: "enquiry", name: "Enquiry" },
      ],
    },
    { name: "s_wTitle", label: "Workshop title" },
    { name: "s_wDate", label: "Workshop date (YYYY-MM-DD)" },
    {
      name: "s_wLang",
      label: "Workshop language",
      type: "select",
      options: [
        { id: "en", name: "English" },
        { id: "zh", name: "Chinese" },
      ],
    },
    { name: "s_formName", label: "Form name (optional)" },
    { name: "s_courseCode", label: "Course code (optional)" },
    { name: "s_classCode", label: "Class code (optional)" },
    { name: "s_company", label: "Ask for company", type: "checkbox" },
    { name: "s_jobTitle", label: "Ask for job title", type: "checkbox" },
    { name: "s_message", label: "Ask for a message", type: "checkbox" },
    { name: "s_deal", label: "Create a deal", type: "checkbox" },
    {
      name: "s_afterKind",
      label: "After submit",
      type: "select",
      options: [
        { id: "message", name: "Show a message" },
        { id: "step", name: "Go to a step" },
        { id: "url", name: "Go to a website" },
      ],
    },
    { name: "s_afterText", label: "Message" },
    { name: "s_afterStep", label: "Step", type: "select", options: steps },
    { name: "s_afterUrl", label: "Website (https)" },
  ];
};

const classLabel = (ctx: Ctx, code: string) => {
  const c = ctx.classes.find((x) => x.code === code);
  return c ? `${c.courseName} (${c.code}) ${c.startDate}, ${c.priceMyr ? `RM ${c.priceMyr}` : "price not set"}, ${c.seatsLabel.replace("_", " ")}` : code;
};

// Canvas-only box that stands in for what the runtime renders.
const box = (el: HTMLElement, text: string) => {
  el.textContent = text;
};

export const LEAD: Def[] = [
  {
    type: "lead-form",
    label: "LEAD form",
    category: "LEAD",
    tag: "div",
    classes: ["lead-form"],
    attrs: (id) => ({ "data-lead": "form", "data-id": id, "data-settings": JSON.stringify(FORM_DEFAULT) }),
    droppable: false, // an EMPTY placeholder: the runtime draws the fields and the consent line
    traits: formTraits,
    read: (a) => formProps(a["data-settings"]),
    write: formWrite,
    paint: (el, a) => {
      const s = parseJson(a["data-settings"]) as { type?: string; fields?: string[] } | undefined;
      box(el, `LEAD form: ${s?.type ?? "not set up"}, ${s?.fields?.length ?? 0} optional field(s). Name, email, phone and consent are always shown.`);
    },
  },
  {
    type: "lead-order-form",
    label: "Order form",
    category: "LEAD",
    tag: "div",
    classes: ["lead-order-form"],
    attrs: (id) => ({ "data-lead": "order", "data-id": id, "data-settings": JSON.stringify({ classCode: "", askCompany: false }) }),
    droppable: false,
    traits: (ctx) => [
      {
        name: "s_classCode",
        label: "Class",
        type: "select",
        options: [{ id: "", name: "Choose a class" }, ...ctx.classes.map((c) => ({ id: c.code, name: `${c.courseName} (${c.code}) ${c.startDate}` }))],
      },
      { name: "s_askCompany", label: "Ask for company", type: "checkbox" },
    ],
    read: (a) => orderProps(a["data-settings"]),
    write: orderWrite,
    paint: (el, a, ctx) => {
      const code = (parseJson(a["data-settings"]) as { classCode?: string } | undefined)?.classCode ?? "";
      box(el, code ? `Order form: ${classLabel(ctx, code)}` : "Order form: choose a class in Settings");
    },
  },
  {
    type: "lead-global-section",
    label: "Global section",
    category: "LEAD",
    tag: "div",
    classes: ["lead-global-section"],
    attrs: (id) => ({ "data-lead": "global-section", "data-id": id }),
    droppable: false,
    // Preview only. A sandboxed iframe with no permissions: nothing in the
    // section's html can run inside the editor. ponytail: fixed height.
    paint: (el, a, ctx) => {
      const g = ctx.sections.find((x) => x.id === a["data-id"]);
      el.replaceChildren();
      if (!g) return box(el, "Global section not found. It will block publishing.");
      const f = el.ownerDocument.createElement("iframe");
      f.setAttribute("sandbox", "");
      f.srcdoc = `<style>body{margin:0}${g.css}</style>${g.html}`;
      f.title = g.name;
      f.style.cssText = "width:100%;height:280px;border:0;pointer-events:none;display:block";
      el.append(f);
    },
  },
  {
    type: "lead-register-button",
    label: "Register button",
    category: "LEAD",
    extend: "link",
    tag: "a",
    classes: ["lead-button", "lead-register-button"],
    attrs: (_, ctx) => ({ href: ctx.steps.find((s) => s.kind === "checkout")?.path ?? "#form" }),
    html: "Register now",
    traits: (ctx) => [
      {
        name: "s_link",
        label: "Checkout step",
        type: "select",
        options: ctx.steps.map((s) => ({ id: `step:${s.path}`, name: s.name })),
      },
    ],
    read: (a) => ({ s_link: `step:${a.href ?? ""}` }),
    write: (p) => ({ attrs: { href: String(p.s_link ?? "").replace(/^step:/, "") } }),
  },
  {
    type: "lead-whatsapp-button",
    label: "WhatsApp button",
    category: "LEAD",
    extend: "link",
    tag: "a",
    classes: ["lead-button", "lead-whatsapp-button"],
    attrs: () => ({ href: "https://wa.me/60000000000" }),
    html: "Chat on WhatsApp",
    traits: [{ name: "s_phone", label: "Number with country code" }],
    read: (a) => waProps(a.href),
    write: waWrite,
  },
];
