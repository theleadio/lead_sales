import type { Editor } from "grapesjs";
import { ALL, marker, newId, type Ctx, type Def } from "./index.ts";

const traitsOf = (d: Def, ctx: Ctx) => (typeof d.traits === "function" ? d.traits(ctx) : (d.traits ?? []));
const NEEDS_ID = new Set(["lead-form", "lead-order-form"]);

// Turns the plain definitions into GrapesJS component types. `onError` gets
// the validation message when a trait value is refused ("" when cleared).
export function registerLeadComponents(editor: Editor, ctx: Ctx, onError: (msg: string) => void) {
  for (const d of ALL) {
    const traits = traitsOf(d, ctx);
    const mark = marker(d);
    const base = Object.entries(d.attrs?.("", ctx) ?? {}); // an empty value (the id) is filled per instance
    const dl = base.find(([k]) => k === "data-lead")?.[1];
    editor.Components.addType(d.type, {
      extend: d.extend,
      isComponent: (el) =>
        el.classList?.contains(mark) || (dl && el.getAttribute?.("data-lead") === dl) ? { type: d.type } : false,
      model: {
        defaults: {
          name: d.label,
          tagName: d.tag,
          classes: d.classes,
          attributes: Object.fromEntries(base.filter(([, v]) => v !== "")),
          ...(d.html !== undefined ? { components: d.html } : {}),
          ...(d.void ? { void: true } : {}),
          ...(d.droppable !== undefined ? { droppable: d.droppable } : {}),
          ...(d.draggable !== undefined ? { draggable: d.draggable } : {}),
          ...(d.type === "lead-form" || d.type === "lead-order-form" || d.type === "lead-global-section" ? { editable: false } : {}),
          ...(d.traits ? { traits: traits.map((t) => ({ ...t, changeProp: true })) } : {}),
        },
        init(this: any) {
          const attrs = this.getAttributes();
          if (NEEDS_ID.has(d.type) && !attrs["data-id"]) this.addAttributes({ "data-id": newId() });
          if (d.read) this.set(d.read(attrs, ctx), { silent: true });
          const apply = () => {
            if (!d.write) return;
            const r = d.write(Object.fromEntries(traits.map((t) => [t.name, this.get(t.name)])), ctx);
            onError(r.error ?? "");
            if (r.error) return;
            if (r.attrs) this.addAttributes(r.attrs);
            if (r.text !== undefined) this.components(r.text);
          };
          for (const t of traits) this.on(`change:${t.name}`, apply);
        },
      },
      view: d.paint
        ? ({
            init(this: any) {
              this.listenTo(this.model, "change:attributes", () => this.paint());
            },
            onRender(this: any) {
              this.paint();
            },
            paint(this: any) {
              d.paint!(this.el, this.model.getAttributes(), ctx);
            },
          } as any)
        : undefined,
    });
  }
}
