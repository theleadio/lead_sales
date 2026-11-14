"use client";

// Add flyout: Quick add / Sections / Rows / Elements / Prebuilt sections.
// Tiles carry data-addsec / data-addrow / data-addel / data-lib so Task 6's
// pointer drag can start from them (see the report).
import { useMemo } from "react";
import { pageCss } from "@/lib/sites/render/css";
import { PageView } from "@/lib/sites/render/view";
import type { ElementType, Preset, Section } from "@/lib/sites/tree";
import { ELEMENT_LIST, presetGlyph, presetLabel, ROW_PRESETS, SECTION_WIDTHS } from "./insert";
import { PREBUILT, PREBUILT_CATEGORIES, type Prebuilt } from "./prebuilt";

export const ADD_CATS = ["Quick add", "Sections", "Rows", "Elements", "Prebuilt sections"] as const;
export type AddCat = (typeof ADD_CATS)[number];

type Props = {
  cat: AddCat;
  onCat: (c: AddCat) => void;
  libCat: string | null;
  onLibCat: (c: string) => void;
  onSection: (w: Section["width"]) => void;
  onPrebuilt: (p: Prebuilt) => void;
  onRow: (p: Preset) => void;
  onElement: (t: ElementType) => void;
};

// Live thumbnail: the real renderer, scaled down. No page CSS leaks: every rule is under .lp.
function Thumb({ p }: { p: Prebuilt }) {
  const { page, css } = useMemo(() => {
    const s = p.build();
    const page = { version: 2 as const, sections: [s], popups: [] };
    return { page, css: pageCss(page) };
  }, [p]);
  return (
    <div className="shot">
      <div>
        <style>{css}</style>
        <PageView page={page} ctx={{ steps: [], pageId: "" }} />
      </div>
    </div>
  );
}

export default function AddFlyout(p: Props) {
  const cats = PREBUILT_CATEGORIES();
  const g = p.libCat && cats.includes(p.libCat) ? p.libCat : cats[0];
  const elements = (
    <>
      <div className="tiles two">
        {ELEMENT_LIST.map((e) => (
          <button key={e.type} className="tile" type="button" data-addel={e.type} onClick={() => p.onElement(e.type)}>
            <span className="glyph" aria-hidden="true">{e.glyph}</span>
            {e.label}
          </button>
        ))}
      </div>
      <p className="note pad">Click to add into the selected column.</p>
    </>
  );
  return (
    <div className="addgrid">
      <div className="cats">
        {ADD_CATS.map((c) => (
          <button key={c} type="button" aria-pressed={c === p.cat} onClick={() => p.onCat(c)}>
            {c}
          </button>
        ))}
        <p className="hint">Sections hold rows. Rows hold columns. Columns hold elements.</p>
      </div>
      <div style={{ overflow: "auto", minHeight: 0 }}>
        {p.cat === "Sections" && (
          <>
            <div className="widths">
              {SECTION_WIDTHS.map((w, i) => (
                <button key={w} className="tile" type="button" data-addsec={w} onClick={() => p.onSection(w)}>
                  <span className="wbar">
                    <i style={{ width: `${[100, 80, 56, 36][i]}%` }} />
                  </span>
                  {w[0].toUpperCase() + w.slice(1)}
                </button>
              ))}
            </div>
            <p className="note pad">Adds an empty section at the end of the page, or after the selected section.</p>
          </>
        )}
        {p.cat === "Rows" && (
          <div className="tiles two">
            {ROW_PRESETS.map((r) => (
              <button key={r} className="tile" type="button" data-addrow={r} onClick={() => p.onRow(r)}>
                <span className="glyph" aria-hidden="true">{presetGlyph(r)}</span>
                {presetLabel(r)}
              </button>
            ))}
          </div>
        )}
        {(p.cat === "Elements" || p.cat === "Quick add") && elements}
        {p.cat === "Prebuilt sections" && (
          <div style={{ display: "grid", minHeight: 0 }}>
            <div className="chips" style={{ padding: 10 }}>
              {cats.map((c) => (
                <button key={c} type="button" aria-pressed={c === g} onClick={() => p.onLibCat(c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className="tiles">
              {PREBUILT.filter((x) => x.category === g).map((x) => (
                <button key={x.name} className="thumb" type="button" data-lib={x.category} data-name={x.name} onClick={() => p.onPrebuilt(x)}>
                  <Thumb p={x} />
                  <div className="cap">{x.name} · click to add</div>
                </button>
              ))}
              {PREBUILT.length === 0 && <p className="note">No prebuilt sections yet.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
