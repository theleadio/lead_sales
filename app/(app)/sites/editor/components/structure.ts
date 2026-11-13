import type { Def } from "./types.ts";

export const col = (grow = 1, inner = "") =>
  `<div class="lead-column"${grow === 1 ? "" : ` style="flex-grow:${grow}"`}>${inner}</div>`;
export const row = (...grows: number[]) => `<div class="lead-row">${grows.map((g) => col(g)).join("")}</div>`;

// Row presets for the Add panel's "Rows" tab (flex-grow ratios).
export const ROWS: { id: string; label: string; html: string }[] = [
  { id: "row-1", label: "1 column", html: row(1) },
  { id: "row-2", label: "2 columns", html: row(1, 1) },
  { id: "row-3", label: "3 columns", html: row(1, 1, 1) },
  { id: "row-4", label: "4 columns", html: row(1, 1, 1, 1) },
  { id: "row-1-2", label: "1/3 + 2/3", html: row(1, 2) },
  { id: "row-2-1", label: "2/3 + 1/3", html: row(2, 1) },
];

export const LAYOUT: Def[] = [
  {
    type: "lead-section",
    label: "Section",
    category: "Layout",
    tag: "section",
    classes: ["lead-section"],
    html: row(1),
    droppable: true,
  },
  {
    type: "lead-row",
    label: "Row",
    category: "Layout",
    tag: "div",
    classes: ["lead-row"],
    html: col() + col(),
    droppable: ".lead-column",
  },
  {
    type: "lead-column",
    label: "Column",
    category: "Layout",
    tag: "div",
    classes: ["lead-column"],
    droppable: true,
    draggable: ".lead-row",
  },
  // A row that lives inside a column; its columns are the nested ones.
  {
    type: "lead-nested-column",
    label: "Nested column",
    category: "Layout",
    tag: "div",
    classes: ["lead-column", "lead-nested-column"],
    droppable: true,
    draggable: ".lead-row",
  },
];
