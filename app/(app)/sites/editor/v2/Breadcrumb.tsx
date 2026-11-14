"use client";

import type { Page } from "@/lib/sites/tree";
import { chain } from "./insert";
import { KIND_COLOR } from "./types";

// Page › Section › Row › Column › Element, each clickable.
export default function Breadcrumb({ page, sel, popupName, onSelect }: { page: Page; sel: string | null; popupName: string | null; onSelect: (id: string | null) => void }) {
  const path = chain(page, sel);
  return (
    <nav className="crumb" aria-label="Selection path">
      <button type="button" className={path.length ? "" : "cur"} aria-current={path.length ? undefined : "location"} onClick={() => onSelect(null)}>
        {popupName ? `🗔 Popup · ${popupName}` : "📄 Page"}
      </button>
      {path.map((n, i) => (
        <span key={n.id} style={{ display: "contents" }}>
          <span className="sepc" aria-hidden="true">
            ›
          </span>
          <button type="button" className={i === path.length - 1 ? "cur" : ""} aria-current={i === path.length - 1 ? "location" : undefined} onClick={() => onSelect(n.id)}>
            <i style={{ background: KIND_COLOR[n.kind] }} />
            {n.kind === "sec" ? `Section · ${n.name}` : n.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
