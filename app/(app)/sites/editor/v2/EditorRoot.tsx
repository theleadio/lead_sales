"use client";

// Editor state, autosave, lock heartbeat, keyboard and the layout that wires
// TopBar / Rail / Flyout / Canvas / RightPanel / Breadcrumb together.
import "./editor.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  findPath, initState, reduce,
  type Action,
} from "@/lib/sites/editor-state";
import { FONTS_URL } from "@/lib/sites/fonts";
import type { ElementType, Page, Popup, Preset, Section } from "@/lib/sites/tree";
import {
  addStepAction, heartbeatAction, publishAction, saveDraftAction, saveSiteSettingsAction, saveValueAction,
} from "../actions";
import { type AddCat } from "./AddFlyout";
import Breadcrumb from "./Breadcrumb";
import Canvas from "./Canvas";
import Flyout, { type FlyActions } from "./Flyout";
import {
  elementTarget, freshCopy, newElement, newRow, newSection, plusTarget, rowTarget, sectionTarget,
} from "./insert";
import InsertMenu, { type MenuState } from "./InsertMenu";
import type { Prebuilt } from "./prebuilt";
import Rail from "./Rail";
import RightPanel from "./RightPanel";
import TopBar from "./TopBar";
import type { ChromeActions } from "./SelectionChrome";
import type { Dev, EditorProps, FlyName, SiteSettingsView, StepInfo, ValueRow } from "./types";

const AUTOSAVE_MS = 3000;
const SETTINGS_MS = 800;
const LOCK_EVERY_MS = 60_000;

type Banner = { kind: "err" | "warn" | "ok"; text: string; list?: string[]; reload?: boolean };
type Phase = "idle" | "saving" | "saved" | "conflict" | "error";

const clean = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined)) as T;

// Are we typing into something (so Delete / Ctrl+Z belong to it)? Duck-typed: the iframe has its own realm.
const typing = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"]');

export default function EditorRoot(props: EditorProps) {
  const { pageId, siteId, readOnly } = props;
  const router = useRouter();
  const [state, rawDispatch] = useReducer(reduce, props.page, initState);
  const dispatch = useCallback(
    (a: Action) => {
      if (readOnly && a.type !== "select") return;
      rawDispatch(a);
    },
    [readOnly],
  );

  const [dev, setDev] = useState<Dev>("d");
  const [fly, setFly] = useState<FlyName | null>(null);
  const [addCat, setAddCat] = useState<AddCat>("Quick add");
  const [libCat, setLibCat] = useState<string | null>(null);
  const [popupRaw, setPopupId] = useState<string | null>(null);
  // Editing a popup that no longer exists (its creation was undone) falls back to the page.
  const popupId = popupRaw && state.page.popups.some((p) => p.id === popupRaw) ? popupRaw : null;
  const [panelOpen, setPanelOpen] = useState(true);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [saved, setSaved] = useState<Page>(props.page);
  const [publishing, setPublishing] = useState(false);
  const [steps, setSteps] = useState<StepInfo[]>(props.steps);
  const [settings, setSettings] = useState<SiteSettingsView>(props.settings);
  const [values, setValues] = useState<ValueRow[]>(props.values);
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null);

  // ---- refs that async code reads ----
  const pageRef = useRef(state.page);
  const savedRef = useRef(props.page);
  const versionRef = useRef(props.version);
  const siteVersionRef = useRef(props.siteVersion);
  const stoppedRef = useRef(readOnly); // conflict / take-over: no more saves
  const failedRef = useRef<Page | null>(null); // the tree the server refused: do not retry it unchanged
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef(0);
  const toastTimer = useRef(0);
  const insertAfter = useRef<string | null>(null);
  const needScroll = useRef(false);
  const settingsRef = useRef(props.settings);
  const settingsKeys = useRef(new Set<keyof SiteSettingsView>());
  const settingsTimer = useRef(0);
  const settingsQ = useRef<Promise<void>>(Promise.resolve());
  const valuesRef = useRef(props.values);
  const valueTimers = useRef(new Map<string, number>());
  const valueQ = useRef<Promise<void>>(Promise.resolve());
  const stateRef = useRef(state);
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  useLayoutEffect(() => {
    pageRef.current = state.page;
    stateRef.current = state;
  });

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 2600);
  }, []);
  const stop = useCallback((text: string, p: Phase = "conflict") => {
    stoppedRef.current = true;
    setPhase(p);
    setBanner({ kind: "err", text, reload: true });
  }, []);

  // ---- autosave ----
  // Saves the current tree. Resolves true when the draft in the database is current.
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    for (let i = 0; i < 6; i++) {
      if (stoppedRef.current) return pageRef.current === savedRef.current;
      if (inflight.current) {
        await inflight.current;
        continue;
      }
      const p = pageRef.current;
      if (p === savedRef.current) return true;
      if (p === failedRef.current) return false;
      const run = (async () => {
        setPhase("saving");
        try {
          const r = await saveDraftAction(pageId, { project: p }, versionRef.current);
          if (r.kind === "ok") {
            versionRef.current = r.version;
            savedRef.current = p;
            failedRef.current = null;
            setSaved(p);
            setPhase("saved");
            return true;
          }
          if (r.kind === "conflict") stop("Changed by someone else — reload");
          else if (r.kind === "locked") stop(`Someone else took over editing (${r.holder}). Reload to see their version.`);
          else if (r.kind === "invalid") {
            failedRef.current = p;
            setPhase("error");
            setBanner({ kind: "err", text: `This page can't be saved: ${r.message}` });
          } else {
            failedRef.current = p;
            setPhase("error");
            setBanner({ kind: "err", text: r.message });
          }
          return false;
        } catch {
          setPhase("error");
          setBanner({ kind: "err", text: "Could not reach the server. Your changes are still here; they will be saved when it is back." });
          timer.current = window.setTimeout(() => void flushRef.current?.(), 10_000);
          return false;
        } finally {
          inflight.current = null;
        }
      })();
      inflight.current = run;
      if (!(await run)) return false;
    }
    return pageRef.current === savedRef.current;
  }, [pageId, stop]);

  useLayoutEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    if (readOnly || stoppedRef.current || state.page === savedRef.current || state.page === failedRef.current) return;
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer.current);
  }, [state.page, readOnly, flush]);

  // ---- site settings (theme, SEO, tracking): debounced, version-checked ----
  const flushSettings = useCallback((): Promise<void> => {
    window.clearTimeout(settingsTimer.current);
    settingsQ.current = settingsQ.current.then(async () => {
      const keys = [...settingsKeys.current];
      settingsKeys.current.clear();
      if (!keys.length || stoppedRef.current) return;
      const cur = settingsRef.current;
      const patch: Record<string, unknown> = {};
      for (const k of keys) patch[k] = k === "seo" || k === "pixels" ? clean(cur[k] as Record<string, unknown>) : cur[k];
      try {
        const r = await saveSiteSettingsAction(siteId, siteVersionRef.current, patch);
        if (r.kind === "ok") siteVersionRef.current = r.version;
        else if (r.message.startsWith("Changed by someone else")) stop("Changed by someone else — reload");
        else setBanner({ kind: "err", text: r.message });
      } catch {
        setBanner({ kind: "err", text: "Could not save the site settings. Try again." });
      }
    });
    return settingsQ.current;
  }, [siteId, stop]);

  const changeSettings = useCallback(
    (patch: Partial<SiteSettingsView>) => {
      if (readOnly) return;
      settingsRef.current = { ...settingsRef.current, ...patch };
      for (const k of Object.keys(patch)) settingsKeys.current.add(k as keyof SiteSettingsView);
      setSettings(settingsRef.current);
      window.clearTimeout(settingsTimer.current);
      settingsTimer.current = window.setTimeout(() => void flushSettings(), SETTINGS_MS);
    },
    [readOnly, flushSettings],
  );

  // ---- custom values ----
  const saveValue = useCallback(
    (key: string) => {
      valueQ.current = valueQ.current.then(async () => {
        const row = valuesRef.current.find((v) => v.key === key);
        if (!row || stoppedRef.current) return;
        try {
          const r = await saveValueAction({ key, label: row.label, value: row.value }, row.version);
          if (r.kind === "ok") {
            valuesRef.current = valuesRef.current.map((v) => (v.key === key ? { ...v, version: r.version } : v));
            setValues(valuesRef.current);
          } else if (r.kind === "conflict") stop("Changed by someone else — reload");
          else setBanner({ kind: "err", text: r.message });
        } catch {
          setBanner({ kind: "err", text: "Could not save the custom value. Try again." });
        }
      });
    },
    [stop],
  );
  const editValue = useCallback(
    (key: string, value: string) => {
      if (readOnly) return;
      valuesRef.current = valuesRef.current.map((v) => (v.key === key ? { ...v, value } : v));
      setValues(valuesRef.current);
      window.clearTimeout(valueTimers.current.get(key));
      valueTimers.current.set(key, window.setTimeout(() => saveValue(key), SETTINGS_MS));
    },
    [readOnly, saveValue],
  );
  const createValue = useCallback(async (v: { key: string; label: string; value: string }): Promise<string | null> => {
    const r = await saveValueAction(v, null);
    if (r.kind === "ok") {
      valuesRef.current = [...valuesRef.current, { ...v, version: r.version }].sort((a, b) => a.label.localeCompare(b.label));
      setValues(valuesRef.current);
      return null;
    }
    return r.kind === "conflict" ? "That key already exists." : r.message;
  }, []);

  const flushAll = useCallback(async () => {
    for (const [k, t] of valueTimers.current) {
      window.clearTimeout(t);
      saveValue(k);
    }
    valueTimers.current.clear();
    await Promise.all([flushSettings(), valueQ.current]);
    return flush();
  }, [flush, flushSettings, saveValue]);

  // ---- lock heartbeat, unload ----
  useEffect(() => {
    if (readOnly) return;
    const beat = window.setInterval(async () => {
      const r = await heartbeatAction(pageId).catch(() => ({ holder: null }));
      if (r.holder && !stoppedRef.current) stop(`Someone else took over editing (${r.holder}). Reload to see their version.`);
    }, LOCK_EVERY_MS);
    const unload = (e: BeforeUnloadEvent) => {
      if (stoppedRef.current || pageRef.current === savedRef.current) return;
      void flush(); // best effort: the request may not finish before the tab closes
      e.preventDefault();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void flushAll();
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearInterval(beat);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [readOnly, pageId, flush, flushAll, stop]);

  // ---- selection ----
  const select = useCallback(
    (id: string | null, scroll = false) => {
      setMenu(null);
      dispatch({ type: "select", id });
      if (id && scroll) setScrollTo({ id, n: Date.now() });
    },
    [dispatch],
  );
  useEffect(() => {
    if (needScroll.current && state.sel) {
      needScroll.current = false;
      setScrollTo({ id: state.sel, n: Date.now() });
    }
  }, [state.sel]);

  // ---- inserting ----
  const apply = useCallback(
    (action: Action) => {
      if (reduce(stateRef.current, action) === stateRef.current) {
        toast("That can't go there.");
        return false;
      }
      needScroll.current = true;
      dispatch(action);
      setMenu(null);
      return true;
    },
    [dispatch, toast],
  );
  const insertSection = useCallback(
    (node: Section, afterId?: string | null) => {
      const ok = apply({ type: "insert", kind: "sec", node, at: sectionTarget(pageRef.current, popupId, stateRef.current.sel, afterId ?? insertAfter.current) });
      if (ok) insertAfter.current = null;
      return ok;
    },
    [apply, popupId],
  );
  const insertRow = useCallback(
    (preset: Preset, at?: ReturnType<typeof rowTarget>) => {
      const target = at ?? rowTarget(pageRef.current, popupId, stateRef.current.sel);
      if (!target) return toast("Add a section first.");
      apply({ type: "insert", kind: "row", node: newRow(preset), at: target });
    },
    [apply, popupId, toast],
  );
  const insertElement = useCallback(
    (type: ElementType, at?: ReturnType<typeof elementTarget>) => {
      const target = at ?? elementTarget(pageRef.current, popupId, stateRef.current.sel);
      if (!target) return toast("Add a section first.");
      apply({ type: "insert", kind: "el", node: newElement(type), at: target });
    },
    [apply, popupId, toast],
  );

  // ---- navigation (flush the save first) ----
  const go = useCallback(
    async (url: string) => {
      const ok = await flushAll();
      if (!ok && pageRef.current !== savedRef.current && !window.confirm("Your last changes could not be saved. Leave anyway?")) return;
      router.push(url);
    },
    [flushAll, router],
  );

  async function preview() {
    const w = window.open("", "_blank"); // opened first so a popup blocker allows it
    await flushAll();
    if (w) w.location.href = `/sites/preview/${pageId}`;
  }
  async function publish() {
    setPublishing(true);
    setBanner(null);
    try {
      if (!(await flushAll())) {
        setBanner((b) => b ?? { kind: "err", text: "Wait for the save to finish, then publish again." });
        return;
      }
      const r = await publishAction(pageId, versionRef.current);
      if (r.kind === "ok") {
        versionRef.current = r.version;
        setSteps((s) => s.map((x) => (x.id === pageId ? { ...x, livePath: props.path } : x)));
        setBanner({ kind: r.removed.length ? "warn" : "ok", text: r.removed.length ? "Published. These were removed from the live page:" : "Published.", list: r.removed });
      } else if (r.kind === "refused") setBanner({ kind: "err", text: "Not published:", list: r.reasons });
      else if (r.kind === "conflict") stop("Changed by someone else — reload");
      else setBanner({ kind: "err", text: r.message });
    } finally {
      setPublishing(false);
    }
  }

  // ---- keyboard (window and the canvas iframe both call this) ----
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const typed = typing(e.target);
      if (e.key === "Escape") {
        if (menu) setMenu(null);
        else if (!typed) select(null);
        return;
      }
      if (typed) return; // fields keep their own undo, Delete and Esc
      if (mod && k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Delete") {
        const s = stateRef.current.sel;
        if (s && !readOnly) {
          e.preventDefault();
          dispatch({ type: "remove", id: s });
        }
      }
    },
    [menu, select, dispatch, readOnly],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // ---- canvas toolbar actions ----
  const chrome = useMemo<ChromeActions>(
    () => ({
      up: (id) => dispatch({ type: "moveUp", id }),
      down: (id) => dispatch({ type: "moveDown", id }),
      settings: () => setPanelOpen(true),
      duplicate: (id) => dispatch({ type: "duplicate", id }),
      remove: (id) => dispatch({ type: "remove", id }),
      plus: (id, anchor) => {
        const kind = findPath(pageRef.current, id)?.kind;
        if (!kind) return;
        const r = anchor.getBoundingClientRect();
        setMenu((m) => (m?.id === id ? null : { id, kind, x: r.left + r.width / 2, y: r.bottom }));
      },
      // Task 6: dragStart(id, event) plugs in here (see the report).
    }),
    [dispatch],
  );

  const flyActions: FlyActions = {
    selectNode: (id) => select(id, true),
    insertSection: (w) => insertSection(newSection(w)),
    insertPrebuilt: (p: Prebuilt) => insertSection(freshCopy(p.build())),
    insertRow: (p) => insertRow(p),
    insertElement: (t) => insertElement(t),
    switchStep: (id) => void go(`/sites/editor/${id}`),
    addStep: async (input) => {
      const r = await addStepAction(siteId, siteVersionRef.current, input);
      if (r.kind === "ok") {
        siteVersionRef.current = r.version;
        setSteps(r.steps);
        toast("Step added.");
        return null;
      }
      if (r.kind === "conflict") {
        stop("Changed by someone else — reload");
        return "Changed by someone else — reload";
      }
      return r.message;
    },
    editPopup: (id) => {
      setPopupId(id);
      select(null);
    },
    addPopup: (name) => dispatch({ type: "addPopup", name, trigger: "button" }),
    updatePopup: (id, patch) => dispatch({ type: "updatePopup", id, patch }),
    changeSettings,
    editValue,
    createValue,
  };

  const valueMap = useMemo(() => Object.fromEntries(values.map((v) => [v.key, v.value])), [values]);
  const current = steps.find((s) => s.id === pageId);
  const dirty = state.page !== saved;
  const status =
    phase === "conflict" ? { text: "Changed by someone else", bad: true }
    : readOnly ? { text: "Read-only", bad: false }
    : phase === "error" ? { text: "Not saved", bad: true }
    : dirty || phase === "saving" ? { text: "Saving…", bad: false }
    : { text: phase === "saved" ? "Saved just now" : "Saved", bad: false };
  const popup: Popup | undefined = popupId ? state.page.popups.find((p) => p.id === popupId) : undefined;

  return (
    <div className="ev2">
      <link rel="stylesheet" href={FONTS_URL} precedence="default" />
      <TopBar
        status={status}
        readOnly={readOnly}
        steps={steps}
        pageId={pageId}
        dev={dev}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        publishing={publishing}
        stopped={phase === "conflict"}
        onBack={() => void go(`/sites/funnel/${siteId}`)}
        onStep={(id) => id !== pageId && void go(`/sites/editor/${id}`)}
        onDev={setDev}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onPreview={() => void preview()}
        onPublish={() => void publish()}
      />
      <div className="urlbar">
        <span>
          {props.domain}
          {props.path === "/" ? "" : props.path}
        </span>
        <span className={`live${current?.livePath ? "" : " draft"}`}>{current?.livePath ? "Live" : "Draft"}</span>
      </div>
      <div>
        {readOnly && <p className="banner warn">Read-only: you can look around, but nothing is saved.</p>}
        {banner && (
          <div role="status" className={`banner ${banner.kind}`}>
            {banner.text}{" "}
            {banner.reload ? (
              <button type="button" onClick={() => location.reload()}>
                Reload
              </button>
            ) : (
              <button type="button" aria-label="Dismiss" onClick={() => setBanner(null)}>
                Dismiss
              </button>
            )}
            {banner.list && (
              <ul>
                {banner.list.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {popup && (
          <div className="banner pop">
            <span>Editing popup: {popup.name}</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => {
                setPopupId(null);
                select(null);
              }}
            >
              Back to page
            </button>
          </div>
        )}
      </div>
      <div className="main">
        <Rail fly={fly} onFly={setFly} />
        <Flyout
          fly={fly}
          onClose={() => setFly(null)}
          readOnly={readOnly}
          page={state.page}
          popupId={popupId}
          sel={state.sel}
          steps={steps}
          pageId={pageId}
          basePath={props.basePath}
          domain={props.domain}
          path={props.path}
          settings={settings}
          values={values}
          valueMap={valueMap}
          addCat={addCat}
          onAddCat={setAddCat}
          libCat={libCat}
          onLibCat={setLibCat}
          a={flyActions}
        />
        <main className="stage" id="stage" onClick={(e) => e.target === e.currentTarget && select(null)}>
          <Canvas
            page={state.page}
            popupId={popupId}
            sel={state.sel}
            dev={dev}
            pageId={pageId}
            steps={steps}
            settings={settings}
            values={valueMap}
            readOnly={readOnly}
            scrollTo={scrollTo}
            onSelect={(id) => select(id)}
            onKey={onKey}
            chrome={chrome}
          />
        </main>
        <RightPanel state={state} dispatch={dispatch} dev={dev} readOnly={readOnly} open={panelOpen} onClose={() => setPanelOpen(false)} />
      </div>
      <Breadcrumb page={state.page} sel={state.sel} popupName={popup?.name ?? null} onSelect={(id) => select(id, true)} />
      {menu && (
        <InsertMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onSection={(w) => insertSection(newSection(w), menu.id)}
          onLibrary={() => {
            insertAfter.current = menu.id;
            setAddCat("Prebuilt sections");
            setFly("add");
            setMenu(null);
          }}
          onRow={(p) => insertRow(p, plusTarget(state.page, menu.id, "row"))}
          onElement={(t) => insertElement(t, plusTarget(state.page, menu.id, menu.kind))}
        />
      )}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
