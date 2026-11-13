"use client";

import "grapesjs/dist/css/grapes.min.css";
import grapesjs, { type Editor } from "grapesjs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CrmScheduleClass } from "@/lib/sites/crm-api";
import { heartbeatAction, publishAction, saveDraftAction } from "./actions";
import { BASE_CSS } from "./components/base-css";
import { ALL, ROWS, type Ctx, type SectionRef, type Step } from "./components";
import { registerLeadComponents } from "./components/register";
import { BRAND_PALETTE, DEVICES, EDITOR_CSS, FONTS_URL, SECTORS } from "./panels";

export type EditorProps = {
  pageId: string;
  siteId: string;
  siteName: string;
  pageName: string;
  path: string;
  version: number;
  project: unknown;
  html: string;
  css: string;
  readOnly: boolean;
  steps: Step[];
  sections: SectionRef[];
  templates: { id: string; name: string; html: string; css: string }[];
  classes: CrmScheduleClass[];
};

type Tab = "add" | "layers" | "style" | "settings";
const TABS: [Tab, string][] = [
  ["add", "Add"],
  ["layers", "Layers"],
  ["style", "Style"],
  ["settings", "Settings"],
];
const SAVE_EVERY_MS = 5000;
const LOCK_EVERY_MS = 60_000;

// Canvas-only look for the empty placeholders (never exported).
const CANVAS_CSS = `
[data-lead=form],[data-lead=order],[data-lead=global-section]{min-height:72px;border:2px dashed #a1bace;background:#f5f5f7;padding:16px;font:14px Inter,system-ui,sans-serif;color:#3d3d3d;display:flex;align-items:center;justify-content:center;text-align:center}
[data-lead=global-section]{padding:0;display:block}
.lead-section,.lead-row,.lead-column{outline:1px dashed rgba(161,186,206,.7);outline-offset:-1px}
`;

// An editor's page is saved as { project, html, css }; getHtml() wraps the body.
const bodyOnly = (h: string) => h.replace(/^\s*<body[^>]*>/i, "").replace(/<\/body>\s*$/i, "");
const hasProject = (p: unknown) => !!p && typeof p === "object" && Object.keys(p).length > 0;

type Banner = { kind: "error" | "warn" | "ok"; text: string; reload?: boolean; list?: string[] };

export default function LeadEditor(props: EditorProps) {
  const { pageId, readOnly } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const blocks = useRef<HTMLDivElement>(null);
  const layers = useRef<HTMLDivElement>(null);
  const styles = useRef<HTMLDivElement>(null);
  const traits = useRef<HTMLDivElement>(null);
  const ed = useRef<Editor | null>(null);
  const version = useRef(props.version);
  const dirty = useRef(false);
  const busy = useRef(false);
  const stopped = useRef(readOnly); // set after a conflict or a take-over: no more saves
  const [tab, setTab] = useState<Tab>("add");
  const [device, setDevice] = useState("desktop");
  const [status, setStatus] = useState(readOnly ? "Read-only" : "Saved");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [working, setWorking] = useState(false);

  // Saves now. Resolves true when the draft in the database is current.
  const save = useCallback(async (): Promise<boolean> => {
    const e = ed.current;
    if (!e || stopped.current) return false;
    if (!dirty.current) return true;
    if (busy.current) return false;
    busy.current = true;
    dirty.current = false;
    setStatus("Saving...");
    try {
      const r = await saveDraftAction(
        pageId,
        { project: e.getProjectData(), html: bodyOnly(e.getHtml({ cleanId: true } as never)), css: e.getCss() ?? "" },
        version.current,
      );
      if (r.kind === "ok") {
        version.current = r.version;
        setStatus(dirty.current ? "Unsaved changes" : "Saved");
        return true;
      }
      dirty.current = true;
      if (r.kind === "conflict") {
        stopped.current = true;
        setStatus("Not saved");
        setBanner({ kind: "error", text: "Changed by someone else — reload", reload: true });
      } else if (r.kind === "locked") {
        stopped.current = true;
        setStatus("Not saved");
        setBanner({ kind: "error", text: `Someone else took over editing (${r.holder}). Reload to see their version.`, reload: true });
      } else {
        setStatus("Not saved");
        setBanner({ kind: "error", text: r.message });
      }
      return false;
    } catch {
      dirty.current = true;
      setStatus("Not saved");
      setBanner({ kind: "error", text: "Could not reach the server. Your changes are still here; they will be saved when it is back." });
      return false;
    } finally {
      busy.current = false;
    }
  }, [pageId]);

  useEffect(() => {
    const ctx: Ctx = { steps: props.steps, classes: props.classes, sections: props.sections };
    const editor = grapesjs.init({
      container: canvas.current!,
      height: "100%",
      width: "auto",
      storageManager: false,
      telemetry: false,
      ...(hasProject(props.project) ? { projectData: props.project as never } : { components: props.html, style: props.css }),
      plugins: [(e: Editor) => registerLeadComponents(e, ctx, setFieldError)],
      panels: { defaults: [] },
      deviceManager: { devices: DEVICES },
      blockManager: { appendTo: blocks.current! },
      layerManager: { appendTo: layers.current! },
      traitManager: { appendTo: traits.current! },
      selectorManager: { appendTo: styles.current! },
      styleManager: { appendTo: styles.current!, sectors: SECTORS as never },
      colorPicker: { palette: [BRAND_PALETTE], showPalette: true, showPaletteOnly: false },
      canvas: { styles: [FONTS_URL] },
      assetManager: {
        embedAsBase64: false,
        // The editor's own endpoint (5 MB; jpg, png, webp, svg). Never inline data: images.
        uploadFile: async (ev: DragEvent) => {
          const files = Array.from(ev.dataTransfer?.files ?? (ev.target as HTMLInputElement | null)?.files ?? []);
          for (const f of files) {
            const body = new FormData();
            body.append("file", f);
            const r = await fetch("/api/site/image", { method: "POST", body }).catch(() => null);
            const j = await r?.json().catch(() => null);
            if (r?.ok && j?.url) editor.AssetManager.add({ src: j.url, type: "image" });
            else setBanner({ kind: "error", text: j?.error?.message ?? "The upload failed." });
          }
        },
      },
    });
    ed.current = editor;

    // Blocks: rows, elements, LEAD pieces, prebuilt sections, global sections.
    const bm = editor.Blocks;
    for (const r of ROWS) bm.add(r.id, { label: r.label, category: "Rows", content: r.html });
    for (const d of ALL.filter((x) => x.type !== "lead-global-section"))
      bm.add(d.type, { label: d.label, category: d.category === "LEAD" ? "LEAD" : "Elements", content: { type: d.type } });
    for (const t of props.templates)
      bm.add(`tpl-${t.id}`, { label: t.name, category: "Prebuilt sections", content: `${t.html}<style>${t.css}</style>` });
    for (const g of props.sections)
      bm.add(`global-${g.id}`, {
        label: g.name,
        category: "Saved assets",
        content: { type: "lead-global-section", attributes: { "data-lead": "global-section", "data-id": g.id } },
      });

    editor.on("load", () => {
      const doc = editor.Canvas.getDocument();
      if (doc) {
        const s = doc.createElement("style");
        s.textContent = CANVAS_CSS;
        doc.head.append(s);
      }
      // Default look of the components, added once; it is part of the page's CSS.
      if (!readOnly && !editor.Css.getRule(".lead-section")) editor.addStyle(BASE_CSS);
      if (readOnly)
        editor.getWrapper()?.onAll((c) =>
          c.set({ selectable: false, hoverable: false, draggable: false, droppable: false, removable: false, copyable: false, editable: false }),
        );
      dirty.current = false;
      editor.on("update", () => {
        if (readOnly || stopped.current) return;
        dirty.current = true;
        setStatus("Unsaved changes");
      });
      editor.on("component:selected", () => setTab((t) => (t === "add" ? "style" : t)));
    });

    const saver = readOnly ? 0 : window.setInterval(() => dirty.current && void save(), SAVE_EVERY_MS);
    const beat = readOnly
      ? 0
      : window.setInterval(async () => {
          const r = await heartbeatAction(pageId).catch(() => ({ holder: null }));
          if (r.holder && !stopped.current) {
            stopped.current = true;
            setStatus("Not saved");
            setBanner({ kind: "error", text: `Someone else took over editing (${r.holder}). Reload to see their version.`, reload: true });
          }
        }, LOCK_EVERY_MS);
    const warn = (ev: BeforeUnloadEvent) => {
      if (dirty.current && !stopped.current) ev.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.clearInterval(saver);
      window.clearInterval(beat);
      window.removeEventListener("beforeunload", warn);
      editor.destroy();
      ed.current = null;
    };
    // The editor is built once; props are the page as it was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickDevice = (id: string) => {
    ed.current?.setDevice(id);
    setDevice(id);
  };

  async function publish() {
    setWorking(true);
    setBanner(null);
    try {
      if (!(await save())) {
        setBanner((b) => b ?? { kind: "error", text: "Wait for the save to finish, then publish again." });
        return;
      }
      const r = await publishAction(pageId, version.current);
      if (r.kind === "ok") {
        setBanner({ kind: r.removed.length ? "warn" : "ok", text: r.removed.length ? "Published. These were removed from the live page:" : "Published.", list: r.removed });
      } else if (r.kind === "refused") {
        setBanner({ kind: "error", text: "Not published:", list: r.reasons });
      } else if (r.kind === "conflict") {
        stopped.current = true;
        setBanner({ kind: "error", text: "Changed by someone else — reload", reload: true });
      } else setBanner({ kind: "error", text: r.message });
    } finally {
      setWorking(false);
    }
  }

  async function preview() {
    // The real renderer (same as the live page), on the saved draft.
    const w = window.open("", "_blank");
    await save();
    if (w) w.location.href = `/sites/preview/${pageId}`;
  }

  const btn =
    "border-line hover:bg-surface-muted cursor-pointer rounded-lg border px-3 py-1.5 text-sm disabled:cursor-default disabled:opacity-50";
  const panel = (t: Tab) => (tab === t ? "min-h-0 flex-1 overflow-y-auto" : "hidden");

  return (
    <div className="bg-surface fixed inset-0 z-50 flex flex-col">
      <style>{EDITOR_CSS}</style>
      <header className="border-line flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <Link href={`/sites/funnel/${props.siteId}`} className="text-sm underline">
          Back to funnel
        </Link>
        <span className="text-sm font-medium">
          {props.siteName} / {props.pageName} <span className="text-ink-muted">{props.path}</span>
        </span>
        <div className="mx-auto flex gap-1" role="group" aria-label="Device">
          {DEVICES.map((d) => (
            <button key={d.id} className={`${btn} ${device === d.id ? "bg-surface-muted font-semibold" : ""}`} onClick={() => pickDevice(d.id)}>
              {d.name} {d.width.replace("px", "")}
            </button>
          ))}
        </div>
        {!readOnly && (
          <>
            <button className={btn} onClick={() => ed.current?.UndoManager.undo()}>
              Undo
            </button>
            <button className={btn} onClick={() => ed.current?.UndoManager.redo()}>
              Redo
            </button>
          </>
        )}
        <span className="text-ink-muted text-sm" aria-live="polite">
          {status}
        </span>
        <button className={btn} onClick={preview}>
          Preview
        </button>
        {!readOnly && (
          <button className="bg-action text-action-ink cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-50" disabled={working || stopped.current} onClick={publish}>
            {working ? "Publishing..." : "Publish"}
          </button>
        )}
      </header>
      {readOnly && <p className="bg-lead-yellow px-4 py-1.5 text-sm">Read-only: you can look around, but nothing is saved.</p>}
      {banner && (
        <div role="status" className={`px-4 py-2 text-sm ${banner.kind === "error" ? "bg-danger text-white" : banner.kind === "warn" ? "bg-lead-yellow" : "bg-lead-blue/40"}`}>
          {banner.text}{" "}
          {banner.reload && (
            <button className="underline" onClick={() => location.reload()}>
              Reload
            </button>
          )}
          {banner.list && (
            <ul className="list-disc pl-5">
              {banner.list.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className={`border-line w-72 flex-col border-r ${readOnly ? "hidden" : "flex"}`}>
          <div className="border-line flex border-b" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 cursor-pointer px-2 py-2 text-sm ${tab === id ? "border-ink border-b-2 font-semibold" : ""}`}>
                {label}
              </button>
            ))}
          </div>
          <div ref={blocks} className={panel("add")} />
          <div ref={layers} className={panel("layers")} />
          <div ref={styles} className={panel("style")} />
          <div className={panel("settings")}>
            {fieldError && <p className="bg-danger px-3 py-2 text-sm text-white">{fieldError}</p>}
            <div ref={traits} />
          </div>
        </aside>
        <div ref={canvas} className="min-w-0 flex-1" />
      </div>
    </div>
  );
}
