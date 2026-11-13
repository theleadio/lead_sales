import { INTERACTIVE } from "./interactive.ts";
import { LAYOUT } from "./structure.ts";
import { LEAD } from "./lead.ts";
import { MEDIA } from "./media.ts";
import { TEXT } from "./text.ts";

export { ROWS } from "./structure.ts";
export * from "./types.ts";

// Order matters when html is parsed: GrapesJS tries the types added LAST first,
// so the specific ones (nested column, register button, ...) come after the
// general ones they share a class with.
export const ALL = [...LAYOUT, ...TEXT, ...MEDIA, ...INTERACTIVE, ...LEAD];
