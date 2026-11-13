import { FONTS } from "../../../../lib/sites/fonts.ts";
// Editor configuration that is plain data (no GrapesJS import): devices, fonts,
// the brand palette and the Style panel's sectors.

// LEAD tokens from app/globals.css, first in the colour picker.
export const BRAND_PALETTE = [
  "#0a0a0a", // ink
  "#3d3d3d", // action / ink-muted
  "#a1bace", // lead-blue
  "#fbe33b", // lead-yellow
  "#ffffff", // surface
  "#f5f5f7", // surface-muted
  "#e5e5ea", // line
  "#b42318", // danger
];

export { FONTS, FONTS_URL } from "../../../../lib/sites/fonts.ts";

// Desktop is edited at 1280 px wide with no media rule; tablet and phone
// rules apply at max-width 991 px / 575 px.
export const DEVICES = [
  { id: "desktop", name: "Desktop", width: "1280px" },
  { id: "tablet", name: "Tablet", width: "768px", widthMedia: "991px" },
  { id: "phone", name: "Phone", width: "375px", widthMedia: "575px" },
];

const stack = (f: string) => `${f}, system-ui, sans-serif`;
export const FONT_OPTIONS = FONTS.map((f) => ({ id: stack(f), label: f }));

export const SECTORS = [
  {
    name: "Layout",
    open: true,
    properties: ["display", "flex-direction", "flex-wrap", "justify-content", "align-items", "gap", "flex-grow", "flex-basis", "width", "max-width", "min-height"],
  },
  { name: "Space", open: false, properties: ["margin", "padding"] },
  {
    name: "Typography",
    open: false,
    properties: [
      { property: "font-family", options: FONT_OPTIONS },
      "font-size",
      "font-weight",
      "color",
      "line-height",
      "letter-spacing",
      "text-align",
      "text-decoration",
    ],
  },
  {
    name: "Background and border",
    open: false,
    properties: ["background-color", "background-image", "border", "border-radius", "box-shadow"],
  },
];

export const EDITOR_CSS = `
.gjs-one-bg{background-color:#f5f5f7}.gjs-two-color{color:#0a0a0a}.gjs-three-bg{background-color:#3d3d3d}.gjs-four-color,.gjs-four-color-h:hover{color:#3d3d3d}
.gjs-block{width:46%;min-height:56px}
.gjs-block-category .gjs-title{background:#ffffff;color:#0a0a0a}
`;
