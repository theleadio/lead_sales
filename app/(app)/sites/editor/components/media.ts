import type { Def } from "./types.ts";

// ponytail: published pages can't carry inline <svg> (the cleaner strips it),
// so "SVG" is an <img> that points at an uploaded .svg file.
const slide = `<div class="lead-slide"><img class="lead-image" alt=""></div>`;

export const MEDIA: Def[] = [
  { type: "lead-image", label: "Image", category: "Media", extend: "image", tag: "img", classes: ["lead-image"], void: true },
  { type: "lead-svg", label: "SVG", category: "Media", extend: "image", tag: "img", classes: ["lead-image", "lead-svg"], void: true },
  {
    type: "lead-image-slider",
    label: "Image slider",
    category: "Media",
    tag: "div",
    classes: ["lead-image-slider"],
    attrs: () => ({ "data-lead": "slider" }),
    html: slide + slide + slide, // children are the slides
    droppable: ".lead-slide",
  },
  {
    type: "lead-slide",
    label: "Slide",
    category: "Media",
    tag: "div",
    classes: ["lead-slide"],
    html: `<img class="lead-image" alt="">`,
    droppable: true,
    draggable: ".lead-image-slider",
  },
  { type: "lead-divider", label: "Divider", category: "Media", tag: "hr", classes: ["lead-divider"], void: true },
  {
    type: "lead-logo-showcase",
    label: "Logo showcase",
    category: "Media",
    tag: "div",
    classes: ["lead-logo-showcase"],
    html: `<img class="lead-image lead-logo" alt="">`.repeat(4),
    droppable: ".lead-logo",
  },
];
