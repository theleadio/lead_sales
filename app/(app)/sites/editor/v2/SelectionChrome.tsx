"use client";

// Hover / select outlines, kind labels, toolbars and "+" buttons.
// Drawn as an overlay ABOVE the iframe (inside .frame, pointer-events:none, only
// the buttons take the mouse). Positions come from getBoundingClientRect() of
// the node inside the iframe; the iframe has no inner scroll, so those
// coordinates are already relative to .frame (the overlay's offset parent).
import { useLayoutEffect, useState } from "react";
import { findPath } from "@/lib/sites/editor-state";
import type { Page } from "@/lib/sites/tree";
import { nodeLabel } from "./insert";
import { KIND_COLOR } from "./types";

export type ChromeActions = {
  up: (id: string) => void;
  down: (id: string) => void;
  settings: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  /** "+" pressed: root opens the insert menu next to `anchor`. */
  plus: (id: string, anchor: HTMLElement) => void;
  /** Task 6: pointerdown on the ⠿ handle starts a drag. Stub until then. */
  dragStart?: (id: string, e: React.PointerEvent<HTMLButtonElement>) => void;
};

type Box = { x: number; y: number; w: number; h: number };
type Props = {
  doc: Document;
  page: Page;
  sel: string | null;
  hov: string | null;
  tick: number;
  layoutKey: string;
  readOnly: boolean;
  actions: ChromeActions;
  keepHover: () => void;
};

const measure = (doc: Document, id: string | null): Box | null => {
  if (!id) return null;
  const w = doc.defaultView;
  const n = doc.querySelector(`[data-node-id="${w?.CSS.escape(id) ?? id}"]`);
  if (!n || !w) return null;
  const r = n.getBoundingClientRect();
  return { x: r.left + w.scrollX, y: r.top + w.scrollY, w: r.width, h: r.height };
};
const same = (a: Box | null, b: Box | null) => (a === b) || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

export default function SelectionChrome({ doc, page, sel, hov, tick, layoutKey, readOnly, actions, keepHover }: Props) {
  const [boxes, setBoxes] = useState<{ sel: Box | null; hov: Box | null }>({ sel: null, hov: null });
  // After every commit (page, selection, hover, device, resize) read the real rects.
  useLayoutEffect(() => {
    const next = { sel: measure(doc, sel), hov: hov && hov !== sel ? measure(doc, hov) : null };
    // Reading layout from the iframe DOM after commit is the one legitimate setState-in-effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoxes((b) => (same(b.sel, next.sel) && same(b.hov, next.hov) ? b : next));
  }, [doc, page, sel, hov, tick, layoutKey]);

  const one = (id: string | null, box: Box | null, selected: boolean) => {
    const f = id ? findPath(page, id) : null;
    if (!id || !box || !f) return null;
    const n = f.node;
    const label = nodeLabel(n);
    const c = KIND_COLOR[n.kind];
    const inside = box.y < 30; // no room above the page top: toolbars sit inside the box
    const col = n.kind === "col"; // columns come from the row layout: no move, copy or delete
    const plusLabel = n.kind === "sec" ? "Add a section below" : n.kind === "row" ? "Add a row below" : "Add an element";
    return (
      <div
        key={selected ? "sel" : "hov"}
        className={`cbox${selected ? " sel" : ""}`}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, ["--c" as string]: c }}
        onMouseEnter={keepHover}
      >
        <span className="tag">{label}</span>
        {!readOnly && (
          <button type="button" className="plus" title={plusLabel} aria-label={plusLabel} onMouseEnter={keepHover} onClick={(e) => actions.plus(id, e.currentTarget)}>
            +
          </button>
        )}
        {selected && !readOnly && (
          <>
            <div className={`tb l${inside ? " in" : ""}`} role="toolbar" aria-label={`${label} tools`}>
              {!col && (
                <>
                  <button type="button" data-drag={id} title="Drag to move" aria-label="Drag to move" onPointerDown={(e) => actions.dragStart?.(id, e)}>
                    ⠿
                  </button>
                  <button type="button" title="Move up" aria-label="Move up" onClick={() => actions.up(id)}>
                    ↑
                  </button>
                  <button type="button" title="Move down" aria-label="Move down" onClick={() => actions.down(id)}>
                    ↓
                  </button>
                </>
              )}
              <button type="button" title="Settings" aria-label="Settings" onClick={() => actions.settings(id)}>
                ⚙
              </button>
            </div>
            {!col && (
              <div className={`tb r${inside ? " in" : ""}`} role="toolbar" aria-label={`${label} actions`}>
                <button type="button" title="Duplicate" aria-label="Duplicate" onClick={() => actions.duplicate(id)}>
                  ⧉
                </button>
                <button type="button" title="Delete" aria-label="Delete" onClick={() => actions.remove(id)}>
                  🗑
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="ov" aria-label="Selection tools">
      {one(hov && hov !== sel ? hov : null, boxes.hov, false)}
      {one(sel, boxes.sel, true)}
    </div>
  );
}
