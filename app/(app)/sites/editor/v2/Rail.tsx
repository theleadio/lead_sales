"use client";

import type { FlyName } from "./types";

const P = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true } as const;
const ICONS: Record<FlyName, React.ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  pages: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
    </>
  ),
  type: <path d="M5 6h14M12 6v13M9 19h6" />,
  bg: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
    </>
  ),
  popups: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="10" height="8" rx="1" />
    </>
  ),
  values: <path d="M8 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3" />,
  seo: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  track: <path d="M3 12h4l3-8 4 16 3-8h4" />,
};
export const FLY_TITLE: Record<FlyName, string> = {
  add: "Add elements",
  layers: "Layers",
  pages: "Pages",
  type: "Typography & colours",
  bg: "Page background",
  popups: "Popups",
  values: "Custom values",
  seo: "SEO & sharing",
  track: "Tracking pixels",
};
const RAIL_TITLE: Partial<Record<FlyName, string>> = { type: "Typography & colours", bg: "Background", track: "Tracking pixels", add: "Add elements" };
const GROUPS: FlyName[][] = [["add", "layers", "pages"], ["type", "bg", "popups", "values", "seo", "track"]];

export default function Rail({ fly, onFly }: { fly: FlyName | null; onFly: (f: FlyName | null) => void }) {
  return (
    <nav className="rail" aria-label="Builder tools">
      {GROUPS.map((g, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span className="sep" />}
          {g.map((f) => {
            const t = RAIL_TITLE[f] ?? FLY_TITLE[f];
            return (
              <button key={f} type="button" title={t} aria-label={t} aria-pressed={fly === f} onClick={() => onFly(fly === f ? null : f)}>
                <svg {...P}>{ICONS[f]}</svg>
              </button>
            );
          })}
        </span>
      ))}
    </nav>
  );
}
