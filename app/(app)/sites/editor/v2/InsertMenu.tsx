"use client";

// The context menu behind a "+" button: section -> widths or the library,
// row -> layouts, column / element -> the element list.
import { useEffect, useRef } from "react";
import type { Kind } from "@/lib/sites/editor-state";
import type { ElementType, Preset, Section } from "@/lib/sites/tree";
import { ELEMENT_LIST, presetLabel, ROW_PRESETS, SECTION_WIDTHS } from "./insert";

export type MenuState = { id: string; kind: Kind; x: number; y: number };
type Props = {
  menu: MenuState;
  onClose: () => void;
  onSection: (width: Section["width"]) => void;
  onLibrary: () => void;
  onRow: (p: Preset) => void;
  onElement: (t: ElementType) => void;
};

export default function InsertMenu({ menu, onClose, onSection, onLibrary, onRow, onElement }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".plus,.emptyadd")) onClose();
    };
    document.addEventListener("mousedown", away, true);
    return () => document.removeEventListener("mousedown", away, true);
  }, [onClose]);

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const b = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = b.indexOf(document.activeElement as HTMLButtonElement);
    b[(i + (e.key === "ArrowDown" ? 1 : -1) + b.length) % b.length]?.focus();
  };

  const left = Math.max(8, Math.min(window.innerWidth - 230, menu.x - 110));
  const top = Math.max(8, Math.min(window.innerHeight - 350, menu.y + 6));
  return (
    <div ref={ref} className="menu" role="menu" aria-label="Insert" style={{ left, top }} onKeyDown={keys}>
      {menu.kind === "sec" && (
        <>
          <h3>Add a section below</h3>
          {SECTION_WIDTHS.map((w) => (
            <button key={w} type="button" role="menuitem" onClick={() => onSection(w)}>
              ▭ {w[0].toUpperCase() + w.slice(1)} width (empty)
            </button>
          ))}
          <h3>Or</h3>
          <button type="button" role="menuitem" onClick={onLibrary}>
            Browse prebuilt sections…
          </button>
        </>
      )}
      {menu.kind === "row" && (
        <>
          <h3>Add a row below</h3>
          {ROW_PRESETS.map((p) => (
            <button key={p} type="button" role="menuitem" onClick={() => onRow(p)}>
              ▤ {presetLabel(p)}
            </button>
          ))}
        </>
      )}
      {(menu.kind === "col" || menu.kind === "el") && (
        <>
          <h3>Add an element</h3>
          {ELEMENT_LIST.map((e) => (
            <button key={e.type} type="button" role="menuitem" onClick={() => onElement(e.type)}>
              <span style={{ width: 18, textAlign: "center" }}>{e.glyph}</span>
              {e.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

