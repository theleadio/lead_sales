// Pointer-event drag and drop (mouse, pen and touch). Thin DOM wiring: the drop
// maths is lib/sites/dnd.ts. The ghost, the drop line and the auto-scroll live
// in the parent document; the canvas iframe is only hit-tested (parent client
// coords minus the iframe rect, then elementFromPoint in its document).
// A press becomes a drag after 5px, so clicks still select.
import { dropTarget, type Drop } from "@/lib/sites/dnd";
import type { DropTarget, Kind, Node } from "@/lib/sites/editor-state";
import type { Page } from "@/lib/sites/tree";
import { KIND_COLOR } from "./types";

export type DragSource =
  | { mode: "move"; kind: Kind; id: string; label: string }
  | { mode: "new"; kind: Kind; make: () => Node; label: string };

export type DragEnv = {
  ctx: () => { page: Page; popupId: string | null };
  /** Commit one insert/move. Only called with a valid target. */
  drop: (src: DragSource, at: DropTarget) => void;
  onStart: () => void;
};

const THRESHOLD = 5;
const EDGE = 60;
const SPEED = 12;

export function beginDrag(src: DragSource, e: PointerEvent, env: DragEnv, capture: Element | null) {
  const root = document.querySelector<HTMLElement>(".ev2");
  const stage = document.getElementById("stage");
  const iframe = document.querySelector<HTMLIFrameElement>(".ev2 .frame iframe");
  if (!root || !stage || !iframe) return;
  try {
    capture?.setPointerCapture(e.pointerId); // moves keep arriving while the pointer is over the iframe
  } catch {
    /* not capturable: window listeners still get the events */
  }
  const x0 = e.clientX;
  const y0 = e.clientY;
  let live = false;
  let px = x0;
  let py = y0;
  let drop: Drop | null = null;
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  let scroller = 0;
  let dimmed: HTMLElement | null = null;

  const hit = () => {
    const doc = iframe.contentDocument;
    const r = iframe.getBoundingClientRect();
    if (!doc || px < r.left || px > r.right || py < r.top || py > r.bottom) return null;
    const x = px - r.left;
    const y = py - r.top;
    const id = doc.elementFromPoint(x, y)?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    const { page, popupId } = env.ctx();
    const rectOf = (nid: string) => {
      const n = doc.querySelector(`[data-node-id="${doc.defaultView?.CSS.escape(nid) ?? nid}"]`);
      return n ? n.getBoundingClientRect() : null;
    };
    return dropTarget(page, popupId, src.kind, src.mode === "move" ? src.id : null, id, y, rectOf);
  };
  const show = () => {
    if (!line) return;
    drop = hit();
    if (!drop) return void (line.hidden = true);
    const r = iframe.getBoundingClientRect();
    line.hidden = false;
    line.style.left = `${r.left + drop.line.x}px`;
    line.style.width = `${drop.line.w}px`;
    line.style.top = `${r.top + drop.line.y - 2}px`;
    line.dataset.label = drop.label;
  };
  const scroll = () => {
    window.clearInterval(scroller);
    scroller = 0;
    const r = stage.getBoundingClientRect();
    const v = py < r.top + EDGE ? -SPEED : py > r.bottom - EDGE ? SPEED : 0;
    // The page moves under a still pointer, so the target is recomputed each tick.
    if (v)
      scroller = window.setInterval(() => {
        stage.scrollBy(0, v);
        show();
      }, 16);
  };

  const start = () => {
    live = true;
    env.onStart();
    root.classList.add("dragging");
    ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.textContent = src.label;
    line = document.createElement("div");
    line.className = "dropline";
    line.hidden = true;
    line.style.setProperty("--dl", KIND_COLOR[src.kind]);
    root.append(ghost, line);
    if (src.mode === "move") {
      const doc = iframe.contentDocument;
      dimmed = doc?.querySelector<HTMLElement>(`[data-node-id="${doc.defaultView?.CSS.escape(src.id) ?? src.id}"]`) ?? null;
      if (dimmed) dimmed.style.opacity = ".35";
    }
  };
  const move = (ev: PointerEvent) => {
    px = ev.clientX;
    py = ev.clientY;
    if (!live) {
      if (Math.hypot(px - x0, py - y0) < THRESHOLD) return;
      start();
    }
    if (!ghost) return;
    ghost.style.left = `${px}px`;
    ghost.style.top = `${py}px`;
    scroll();
    show();
  };
  const finish = (commit: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    iframe.contentDocument?.removeEventListener("keydown", key, true);
    window.clearInterval(scroller);
    try {
      capture?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!live) return;
    ghost?.remove();
    line?.remove();
    root.classList.remove("dragging");
    if (dimmed) dimmed.style.opacity = "";
    // The click that follows a drag must not select or insert anything.
    const swallow = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, true);
    window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    if (commit && drop) env.drop(src, drop.target);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.stopImmediatePropagation(); // the editor's own Esc (deselect) must not also run
    ev.preventDefault();
    finish(false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  iframe.contentDocument?.addEventListener("keydown", key, true);
}
