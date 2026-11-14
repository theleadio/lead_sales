"use client";

// Layers, Pages and Popups flyouts.
import { useState } from "react";
import type { Node } from "@/lib/sites/editor-state";
import type { Page, Popup } from "@/lib/sites/tree";
import { KIND_COLOR, type StepInfo } from "./types";

const label = (n: Node) => (n.kind === "sec" ? `Section · ${n.name}` : n.name);

export function LayersFlyout({ page, popupId, sel, onSelect }: { page: Page; popupId: string | null; sel: string | null; onSelect: (id: string) => void }) {
  const secs = popupId ? page.popups.find((p) => p.id === popupId)?.sections ?? [] : page.sections;
  const line = (n: Node, d: number) => (
    <button key={n.id} type="button" style={{ paddingLeft: 6 + d * 14 }} aria-current={n.id === sel} onClick={() => onSelect(n.id)}>
      <i style={{ background: KIND_COLOR[n.kind] }} />
      {label(n)}
    </button>
  );
  if (!secs.length) return <p className="empty">Nothing on this {popupId ? "popup" : "page"} yet. Use Add to put a section on it.</p>;
  return (
    <div className="tree">
      {secs.flatMap((s) => [
        line(s, 0),
        ...s.rows.flatMap((r) => [line(r, 1), ...r.cols.flatMap((c) => [line(c, 2), ...c.els.map((e) => line(e, 3))])]),
      ])}
    </div>
  );
}

export function PagesFlyout({
  steps, pageId, basePath, onSwitch, onAdd,
}: {
  steps: StepInfo[];
  pageId: string;
  basePath: string;
  onSwitch: (id: string) => void;
  onAdd: (i: { name: string; path: string; kind: "page" | "checkout" | "thank_you" }) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState(basePath === "/" ? "/" : `${basePath}/`);
  const [kind, setKind] = useState<"page" | "checkout" | "thank_you">("page");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setErr("");
    const e = await onAdd({ name, path, kind });
    setBusy(false);
    if (e) setErr(e);
    else {
      setOpen(false);
      setName("");
    }
  };
  return (
    <div className="list">
      {steps.map((s) => (
        <button key={s.id} className="li" type="button" aria-current={s.id === pageId} style={s.id === pageId ? { borderColor: "var(--accent)" } : undefined} onClick={() => s.id !== pageId && onSwitch(s.id)}>
          <span aria-hidden="true">📄</span>
          <span className="grow">
            <b>{s.name}</b>
            <br />
            <span className="note">{s.path}</span>
          </span>
        </button>
      ))}
      {!open ? (
        <button className="btn" type="button" onClick={() => setOpen(true)}>
          ＋ Add new page
        </button>
      ) : (
        <form
          className="f"
          style={{ gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="f">
            <span>Name</span>
            <input className="inp2" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="f">
            <span>Path</span>
            <input className="inp2" value={path} onChange={(e) => setPath(e.target.value)} required />
          </label>
          <label className="f">
            <span>Step type</span>
            <select className="inp2" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="page">Page</option>
              <option value="checkout">Checkout</option>
              <option value="thank_you">Thank you</option>
            </select>
          </label>
          {err && (
            <p className="note" role="alert" style={{ color: "#b42318" }}>
              {err}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" type="submit" disabled={busy}>
              Add step
            </button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const WHEN: Record<Popup["trigger"], string> = { exit: "when the visitor moves to leave", timer: "after a delay", button: "from a button" };

export function PopupsFlyout({
  popups, onEdit, onAdd, onUpdate,
}: {
  popups: Popup[];
  onEdit: (id: string) => void;
  onAdd: (name: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<Popup, "name" | "trigger" | "delaySec">>) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="list">
      {popups.map((p) => (
        <div key={p.id} className="li" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden="true">🗔</span>
            <span className="grow">
              <b>{p.name}</b>
              <br />
              <span className="note">Opens: {WHEN[p.trigger]}{p.trigger === "timer" ? ` (${p.delaySec ?? 10}s)` : ""}</span>
            </span>
            <button className="btn" type="button" onClick={() => onEdit(p.id)}>
              Edit
            </button>
          </div>
          <label className="f">
            <span>{p.name} opens</span>
            <select
              className="inp2"
              value={p.trigger}
              onChange={(e) => {
                const trigger = e.target.value as Popup["trigger"];
                onUpdate(p.id, trigger === "timer" ? { trigger, delaySec: p.delaySec ?? 10 } : { trigger });
              }}
            >
              <option value="exit">When the visitor moves to leave</option>
              <option value="timer">After a delay</option>
              <option value="button">Only from a button</option>
            </select>
          </label>
          {p.trigger === "timer" && (
            <label className="f">
              <span>Delay (seconds)</span>
              <input
                className="inp2"
                type="number"
                min={0}
                max={600}
                value={p.delaySec ?? 10}
                onChange={(e) => onUpdate(p.id, { delaySec: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
              />
            </label>
          )}
        </div>
      ))}
      <form
        className="f"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(name.trim() || "New popup");
          setName("");
        }}
      >
        <label className="f">
          <span>New popup name</span>
          <input className="inp2" value={name} placeholder="New popup" onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <button className="btn primary" type="submit" style={{ justifyContent: "center" }}>
          ＋ Create new popup
        </button>
      </form>
      <p className="note">Popups are built with the same sections, rows, columns and elements as pages. Buttons can open them.</p>
    </div>
  );
}
