"use client";

// Inline text editing on the canvas. The text node in the iframe becomes
// contenteditable; its floating toolbar is drawn in the parent (above the
// iframe, like the selection chrome). The editable starts from the RAW text in
// editor state ({{key}} shown as non-editable chips) and one `update` is
// committed when editing ends (Done, Esc or a click outside), never per keystroke.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { chip, plainToRich, safeHref, serialize, toEditable } from "@/lib/sites/richclient";
import type { ValueRow } from "./types";

type Props = {
  doc: Document;
  id: string;
  raw: string; // the element's text as stored
  vals: Record<string, string>;
  list: ValueRow[];
  tick: number;
  onCommit: (id: string, html: string) => void;
  onEnd: () => void;
  note: (m: string) => void;
};

const sel = (doc: Document, id: string) => `[data-node-id="${doc.defaultView?.CSS.escape(id) ?? id}"]`;

export default function InlineText(p: Props) {
  const latest = useRef(p);
  const finishRef = useRef<(save: boolean, notify: boolean) => void>(() => {});
  const hostRef = useRef<HTMLElement | null>(null);
  const range = useRef<Range | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; h: number } | null>(null);
  const [menu, setMenu] = useState(false);
  useLayoutEffect(() => {
    latest.current = p;
  });

  useEffect(() => {
    const { doc, id } = latest.current;
    const host = doc.querySelector(sel(doc, id))?.querySelector<HTMLElement>(".t") ?? null;
    if (!host) return void latest.current.onEnd();
    hostRef.current = host;
    const raw = latest.current.raw;
    const saved = host.innerHTML; // what React rendered; put back before React re-renders
    host.innerHTML = toEditable(raw, latest.current.vals);
    host.setAttribute("contenteditable", "true");
    host.focus();
    const sel0 = doc.getSelection();
    if (sel0) {
      const r = doc.createRange();
      r.selectNodeContents(host);
      r.collapse(false);
      sel0.removeAllRanges();
      sel0.addRange(r);
    }

    let done = false;
    const finish = (save: boolean, notify: boolean) => {
      if (done) return;
      done = true;
      doc.removeEventListener("pointerdown", inside, true);
      document.removeEventListener("pointerdown", outside, true);
      host.removeEventListener("keydown", key);
      host.removeEventListener("paste", paste);
      host.removeEventListener("drop", noDrop);
      const html = serialize(host);
      host.removeAttribute("contenteditable");
      host.innerHTML = saved;
      if (save && html !== raw) latest.current.onCommit(id, html);
      if (notify) latest.current.onEnd();
    };
    finishRef.current = finish;

    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // the editor's own Esc (deselect) must not also run
        finish(true, true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        doc.execCommand("insertLineBreak");
      }
    };
    // Paste: only the allowed subset gets in (no styles, classes, scripts from Word / Docs).
    const paste = (e: ClipboardEvent) => {
      e.preventDefault();
      const html = e.clipboardData?.getData("text/html");
      const clean = html
        ? serialize(new DOMParser().parseFromString(html, "text/html").body)
        : plainToRich(e.clipboardData?.getData("text/plain") ?? "");
      if (clean) doc.execCommand("insertHTML", false, clean);
    };
    const noDrop = (e: Event) => e.preventDefault();
    // A click outside (page, or parent chrome other than the toolbar) ends editing.
    const outside = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.(".rte")) finish(true, true);
    };
    const inside = (e: Event) => {
      if (!host.contains(e.target as Node)) finish(true, true);
    };
    host.addEventListener("keydown", key);
    host.addEventListener("paste", paste);
    host.addEventListener("drop", noDrop);
    doc.addEventListener("pointerdown", inside, true);
    document.addEventListener("pointerdown", outside, true);
    return () => finish(true, false); // unmounted (undo removed it, navigation): keep what was typed
  }, []);

  // Toolbar position: the host's rect inside the iframe (same space as the selection chrome).
  useLayoutEffect(() => {
    const host = hostRef.current;
    const w = p.doc.defaultView;
    if (!host || !w) return;
    const r = host.getBoundingClientRect();
    const next = { x: r.left + w.scrollX, y: r.top + w.scrollY, h: r.height };
    // Layout read from the iframe after commit.
    setBox((b) => (b && b.x === next.x && b.y === next.y && b.h === next.h ? b : next));
  }, [p.tick, p.doc]);

  const run = (cmd: string) => {
    hostRef.current?.focus();
    p.doc.execCommand(cmd);
  };
  const remember = () => {
    const s = p.doc.getSelection();
    range.current = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  };
  const restore = () => {
    hostRef.current?.focus();
    const s = p.doc.getSelection();
    if (s && range.current) {
      s.removeAllRanges();
      s.addRange(range.current);
    }
  };
  const link = () => {
    remember();
    if (!range.current || range.current.collapsed) return p.note("Select the text you want to link first.");
    const url = window.prompt("Link address (https://, mailto:, tel: or #)", "https://");
    restore();
    if (url === null) return;
    if (!url.trim()) return void p.doc.execCommand("unlink");
    const ok = safeHref(url);
    if (!ok) return p.note("Links must start with https://, mailto:, tel: or #.");
    p.doc.execCommand("createLink", false, ok);
  };
  const insertValue = (k: string) => {
    setMenu(false);
    restore();
    p.doc.execCommand("insertHTML", false, chip(k, p.vals[k] ?? `{{${k}}}`) + "&nbsp;");
  };

  if (!box) return null;
  const width = p.doc.documentElement.clientWidth;
  const above = box.y - 44 >= 4;
  return (
    <div className="ov" aria-label="Text formatting">
      <div
        className="rte"
        role="toolbar"
        aria-label="Text formatting"
        style={{ left: Math.max(4, Math.min(box.x, width - 330)), top: above ? box.y - 44 : box.y + box.h + 6 }}
        onMouseDown={(e) => e.preventDefault()} // keep the selection in the page
      >
        <button type="button" title="Bold" aria-label="Bold" onClick={() => run("bold")}>
          <b>B</b>
        </button>
        <button type="button" title="Italic" aria-label="Italic" onClick={() => run("italic")}>
          <i>I</i>
        </button>
        <button type="button" title="Underline" aria-label="Underline" onClick={() => run("underline")}>
          <u>U</u>
        </button>
        <button type="button" title="Strikethrough" aria-label="Strikethrough" onClick={() => run("strikeThrough")}>
          <s>S</s>
        </button>
        <span className="s" />
        <button type="button" title="Link" aria-label="Link" onClick={link}>
          🔗
        </button>
        <button
          type="button"
          title="Insert custom value"
          aria-label="Insert custom value"
          aria-expanded={menu}
          onClick={() => {
            remember();
            setMenu((m) => !m);
          }}
        >
          {"{ }"}
        </button>
        <span className="s" />
        <button type="button" className="done" title="Done" onClick={() => finishRef.current(true, true)}>
          Done
        </button>
        {menu && (
          <div className="menu rtem" role="menu">
            <h3>Custom values</h3>
            {p.list.map((v) => (
              <button key={v.key} type="button" role="menuitem" onClick={() => insertValue(v.key)}>
                {v.label} <span style={{ color: "var(--muted)" }}>{`{{${v.key}}}`}</span>
              </button>
            ))}
            {p.list.length === 0 && <p className="note">No custom values yet. Add them from the Values panel.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
