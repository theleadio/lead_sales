import type { Theme } from "@/lib/sites/model";
import type { Page } from "@/lib/sites/tree";

export type StepInfo = { id: string; name: string; path: string; kind: string; livePath: string | null };
export type ClassOpt = { code: string; courseName: string; startDate: string };
export type ValueRow = { key: string; label: string; value: string; version: number };
export type SiteSettingsView = {
  theme: Theme;
  seo: { title?: string; description?: string; image?: string; noindex?: boolean };
  pixels: { meta?: string; google?: string; linkedin?: string; tiktok?: string };
  capi: boolean;
};

export type EditorProps = {
  pageId: string;
  siteId: string;
  siteName: string;
  domain: string;
  basePath: string;
  pageName: string;
  path: string;
  version: number;
  siteVersion: number;
  page: Page;
  readOnly: boolean;
  steps: StepInfo[];
  settings: SiteSettingsView;
  values: ValueRow[];
  classes: ClassOpt[];
};

export type Dev = "d" | "t" | "m";
export const DEV_W: Record<Dev, number> = { d: 1200, t: 768, m: 390 };
export const DEV_LABEL: Record<Dev, string> = { d: "Desktop", t: "Tablet", m: "Phone" };

export type FlyName = "add" | "layers" | "pages" | "type" | "bg" | "popups" | "values" | "seo" | "track";

export const KIND_COLOR = { sec: "#16a34a", row: "#2563eb", col: "#9333ea", el: "#ea580c" } as const;
export const KIND_NAME = { sec: "Section", row: "Row", col: "Column", el: "Element" } as const;
