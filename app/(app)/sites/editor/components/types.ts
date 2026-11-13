import type { CrmScheduleClass } from "../../../../../lib/sites/crm-api.ts";

// Plain-data definitions of the editor's components. Nothing here imports
// GrapesJS, so the markers each one emits can be tested without a browser;
// register.ts turns them into GrapesJS types.

export type Step = { id: string; name: string; path: string; kind: string };
export type SectionRef = { id: string; name: string; html: string; css: string };
export type Ctx = { steps: Step[]; classes: CrmScheduleClass[]; sections: SectionRef[] };
export type Attrs = Record<string, string>;

export type TraitDef = {
  name: string; // always changeProp; names start "s_" (a bare "type" would clash with the model)
  label: string;
  type?: "text" | "number" | "checkbox" | "select";
  options?: { id: string; name: string }[];
};

export type Category = "Layout" | "Text" | "Media" | "Interactive" | "LEAD";

export type Def = {
  type: string;
  label: string;
  category: Category;
  extend?: "text" | "image" | "link";
  tag: string;
  // First class is shared, the LAST one identifies the type when html is parsed.
  classes: string[];
  attrs?: (id: string, ctx: Ctx) => Attrs;
  html?: string; // default children
  void?: boolean;
  droppable?: boolean | string;
  draggable?: boolean | string;
  traits?: TraitDef[] | ((ctx: Ctx) => TraitDef[]);
  // Trait values <- the element's attributes (when a saved page is loaded).
  read?: (attrs: Attrs, ctx: Ctx) => Record<string, unknown>;
  // Trait values -> what the element carries. `error` leaves it unchanged.
  write?: (props: Record<string, unknown>, ctx: Ctx) => { attrs?: Attrs; text?: string; error?: string };
  // Canvas-only decoration, never exported.
  paint?: (el: HTMLElement, attrs: Attrs, ctx: Ctx) => void;
};

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

// What a component exports as HTML (settings JSON in single quotes, as the
// published-page contract describes; GrapesJS itself serialises the same
// attribute with double quotes, which is equivalent).
export function renderDef(d: Def, ctx: Ctx, id = "test-id"): string {
  const attrs = d.attrs?.(id, ctx) ?? {};
  const parts = [`class="${d.classes.join(" ")}"`];
  for (const [k, v] of Object.entries(attrs)) parts.push(k === "data-settings" ? `${k}='${v}'` : `${k}="${esc(v)}"`);
  const open = `<${d.tag} ${parts.join(" ")}>`;
  return d.void ? open : `${open}${d.html ?? ""}</${d.tag}>`;
}

export const marker = (d: Def) => d.classes[d.classes.length - 1];
export const emptyCtx: Ctx = { steps: [], classes: [], sections: [] };
export const newId = () => `f-${crypto.randomUUID().slice(0, 8)}`;
