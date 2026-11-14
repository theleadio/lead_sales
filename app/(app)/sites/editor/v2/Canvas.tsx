"use client";

// The canvas: a same-origin <iframe> whose <body> is a React portal target.
// PageView(forEditor) renders the page into it; pageCss + runtime.css + the
// editor-only stylesheet go into its <head>. runtime.js is NOT loaded.
//
// Selection chrome is NOT inside the iframe: SelectionChrome draws it above
// the iframe, in the parent document, from getBoundingClientRect(). The iframe
// is sized to its content (no inner scroll), so the stage scrolls and an
// iframe-viewport rect equals a position inside `.frame` (the overlay's
// offset parent). Hit-testing is closest("[data-node-id]") in the iframe.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FONTS_URL } from "@/lib/sites/fonts";
import { pageCss } from "@/lib/sites/render/css";
import { PageView } from "@/lib/sites/render/view";
import { RICH_FIELDS, type Element as El, type Page, type Section } from "@/lib/sites/tree";
import { CANVAS_CSS } from "./canvas-css";
import SelectionChrome, { type ChromeActions } from "./SelectionChrome";
import { DEV_W, type Dev, type SiteSettingsView, type StepInfo } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Canvas-only copy of the page: {{key}} shown as a value chip. The real tree
// (editor state) keeps the raw tokens; inline editing (Task 6) must read that.
function withValues(page: Page, vals: Record<string, string>): Page {
  const tok = (h: string) => h.replace(/\{\{([a-z][a-z0-9_]{1,40})\}\}/g, (m, k: string) => `<span class="mv" title="${m}">${esc(vals[k] ?? m)}</span>`);
  const fixEl = (e: El): El => {
    const kind = RICH_FIELDS[e.type];
    const p = e.props as Record<string, unknown>;
    if (kind === "text" && typeof p.text === "string") return { ...e, props: { ...p, text: tok(p.text) } };
    if (kind === "items" && Array.isArray(p.items))
      return { ...e, props: { ...p, items: p.items.map((i: unknown) => (Array.isArray(i) ? i.map((x) => tok(String(x))) : tok(String(i)))) } };
    return e;
  };
  const fix = (s: Section): Section => ({ ...s, rows: s.rows.map((r) => ({ ...r, cols: r.cols.map((c) => ({ ...c, els: c.els.map(fixEl) })) })) });
  return { ...page, sections: page.sections.map(fix), popups: page.popups.map((p) => ({ ...p, sections: p.sections.map(fix) })) };
}

// Device and popup mode are classes/attributes on the iframe body (the editor stylesheet keys off them).
function setBodyMode(doc: Document, dev: Dev, popup: boolean) {
  doc.body.dataset.dev = dev;
  doc.body.classList.toggle("popmode", popup);
}

const SRC_DOC = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>";

type Props = {
  page: Page;
  popupId: string | null;
  sel: string | null;
  dev: Dev;
  pageId: string;
  steps: StepInfo[];
  settings: SiteSettingsView;
  values: Record<string, string>;
  readOnly: boolean;
  empty: boolean;
  onEmptyAdd: (anchor: HTMLElement) => void;
  scrollTo: { id: string; n: number } | null;
  onSelect: (id: string | null) => void;
  onKey: (e: KeyboardEvent) => void;
  chrome: ChromeActions;
};

export default function Canvas(p: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const leave = useRef<number>(0);
  const latest = useRef(p);
  useLayoutEffect(() => {
    latest.current = p;
  });

  const shown = useMemo(() => {
    const full = withValues(p.page, p.values);
    const pop = p.popupId ? full.popups.find((x) => x.id === p.popupId) : null;
    return pop ? { ...full, sections: pop.sections, popups: [] } : full;
  }, [p.page, p.values, p.popupId]);
  const css = useMemo(() => pageCss(p.page, { settings: p.settings }), [p.page, p.settings]);
  const ctx = useMemo(() => ({ steps: p.steps.map((s) => ({ id: s.id, path: s.path })), pageId: p.pageId, forEditor: true }), [p.steps, p.pageId]);

  // Hit-testing and keys inside the iframe document.
  useEffect(() => {
    if (!doc) return;
    const idOf = (t: EventTarget | null) => (t as Element | null)?.closest?.("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    const over = (e: MouseEvent) => {
      window.clearTimeout(leave.current);
      setHov(idOf(e.target));
    };
    // Leaving the iframe for a chrome button must not drop the hover before the click lands.
    const out = () => {
      leave.current = window.setTimeout(() => setHov(null), 120);
    };
    const click = (e: MouseEvent) => {
      e.preventDefault(); // links, summaries and buttons are inert in the editor
      latest.current.onSelect(idOf(e.target));
    };
    const key = (e: KeyboardEvent) => latest.current.onKey(e);
    doc.addEventListener("mouseover", over);
    doc.documentElement.addEventListener("mouseleave", out);
    doc.addEventListener("click", click);
    doc.addEventListener("keydown", key);
    return () => {
      doc.removeEventListener("mouseover", over);
      doc.documentElement.removeEventListener("mouseleave", out);
      doc.removeEventListener("click", click);
      doc.removeEventListener("keydown", key);
    };
  }, [doc]);

  // The iframe is as tall as its content, so the stage (not the iframe) scrolls.
  useEffect(() => {
    if (!doc) return;
    const fit = () => {
      if (frameRef.current) frameRef.current.style.height = `${Math.ceil(doc.body.getBoundingClientRect().height)}px`;
      setTick((n) => n + 1);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(doc.body);
    if (frameRef.current) ro.observe(frameRef.current); // a device switch resizes the iframe, not only its body
    const frame = frameRef.current?.parentElement;
    frame?.addEventListener("transitionend", fit); // width animation ended: measure again
    doc.addEventListener("scroll", fit);
    fit();
    const late = doc.defaultView;
    late?.addEventListener("load", fit);
    doc.fonts?.addEventListener?.("loadingdone", fit);
    return () => {
      ro.disconnect();
      frame?.removeEventListener("transitionend", fit);
      doc.removeEventListener("scroll", fit);
      late?.removeEventListener("load", fit);
      doc.fonts?.removeEventListener?.("loadingdone", fit);
    };
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    setBodyMode(doc, p.dev, !!p.popupId);
  }, [doc, p.dev, p.popupId]);

  useEffect(() => {
    if (!doc || !p.scrollTo) return;
    const id = p.scrollTo.id;
    const n = doc.querySelector(`[data-node-id="${doc.defaultView?.CSS.escape(id) ?? id}"]`);
    n?.scrollIntoView({ block: "center" });
  }, [doc, p.scrollTo]);

  // A popup or a deleted node must not stay hovered.
  const hovId = hov && doc?.querySelector(`[data-node-id="${doc.defaultView?.CSS.escape(hov) ?? hov}"]`) ? hov : null;
  useEffect(() => () => window.clearTimeout(leave.current), []);
  const keepHover = useCallback(() => window.clearTimeout(leave.current), []);

  return (
    <div className="frame" style={{ width: `min(${DEV_W[p.dev]}px, 100%)` }} data-canvas-frame>
      <iframe ref={frameRef} title="Page canvas" srcDoc={SRC_DOC} onLoad={() => setDoc(frameRef.current?.contentDocument ?? null)} />
      {doc &&
        createPortal(
          <>
            {/* eslint-disable @next/next/no-css-tags -- these go into the canvas iframe's own <head> */}
            <link rel="stylesheet" href={FONTS_URL} />
            <link rel="stylesheet" href="/site/runtime.css" />
            {/* eslint-enable @next/next/no-css-tags */}
            <style>{css}</style>
            <style>{CANVAS_CSS}</style>
          </>,
          doc.head,
        )}
      {doc &&
        createPortal(
          p.popupId ? (
            <div className="popwrap">
              <div className="pop">
                <PageView page={shown} ctx={ctx} />
              </div>
            </div>
          ) : (
            <PageView page={shown} ctx={ctx} />
          ),
          doc.body,
        )}
      {doc && p.empty && !p.readOnly && (
        <button type="button" className="emptyadd" onClick={(e) => p.onEmptyAdd(e.currentTarget)}>
          + Add section
        </button>
      )}
      {doc && (
        <SelectionChrome
          doc={doc}
          page={p.page}
          sel={p.sel}
          hov={hovId}
          tick={tick}
          layoutKey={`${p.dev}|${p.popupId ?? ""}`}
          readOnly={p.readOnly}
          actions={p.chrome}
          keepHover={keepHover}
        />
      )}
    </div>
  );
}
