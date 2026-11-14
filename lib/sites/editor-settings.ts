// Pure helpers for the settings panel: responsive values, hex, lists, urls.
import type { R } from "./elements.ts";

export type Dev = "d" | "t" | "m";

/** The value shown for a device: phone falls back to tablet then desktop, tablet to desktop. */
export function readR(r: R, dev: Dev): number {
  if (dev === "m") return r.m ?? r.t ?? r.d;
  if (dev === "t") return r.t ?? r.d;
  return r.d;
}

/** Does this device carry its own value? Desktop always does. */
export const isSetR = (r: R, dev: Dev): boolean => dev === "d" || (dev === "t" ? r.t != null : r.m != null);

/** Set one device's value; the other devices keep theirs. */
export function writeR(r: R, dev: Dev, v: number): R {
  return { ...r, [dev]: v };
}

/** Remove a tablet/phone override so it follows the inherited value again. Desktop cannot be reset. */
export function resetR(r: R, dev: Dev): R {
  if (dev === "d") return r;
  const next = { ...r };
  delete next[dev];
  return next;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const validHex = (s: string): boolean => HEX.test(s);
/** #abc -> #aabbcc (for <input type=color>); anything invalid -> fallback. */
export function hex6(s: string, fallback = "#111827"): string {
  if (!validHex(s)) return fallback;
  const l = s.toLowerCase();
  return l.length === 4 ? `#${l[1]}${l[1]}${l[2]}${l[2]}${l[3]}${l[3]}` : l;
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export const toLines = (items: string[]): string => items.join("\n");
export const fromLines = (s: string): string[] => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** Same rules as safeUrl in elements.ts, returning a message instead of a boolean. */
export function urlError(v: string): string | null {
  if (v === "" || /^(https:|mailto:|tel:|#)/i.test(v) || /^\/(?![/\\])/.test(v)) return v.length > 2048 ? "Too long" : null;
  return "Use an address starting with https:// or a /path";
}
/** Images and links must be https or a /path (no mailto/tel/#). */
export function imageUrlError(v: string): string | null {
  if (v === "" || /^https:/i.test(v) || /^\/(?![/\\])/.test(v)) return v.length > 2048 ? "Too long" : null;
  return "Use an https:// address or a /path";
}
/** Button "open a website": https only. */
export function httpsOnlyError(v: string): string | null {
  return v === "" || /^https:\/\//i.test(v) ? null : "Use an address starting with https://";
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}
