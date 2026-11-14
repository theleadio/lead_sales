"use client";

import { DEV_LABEL, type Dev, type StepInfo } from "./types";

type Props = {
  status: { text: string; bad: boolean };
  readOnly: boolean;
  steps: StepInfo[];
  pageId: string;
  dev: Dev;
  canUndo: boolean;
  canRedo: boolean;
  publishing: boolean;
  stopped: boolean;
  onBack: () => void;
  onStep: (id: string) => void;
  onDev: (d: Dev) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPreview: () => void;
  onPublish: () => void;
};

export default function TopBar(p: Props) {
  return (
    <header className="top">
      <button className="btn" type="button" onClick={p.onBack}>
        ← Back
      </button>
      <span className={`saved${p.status.bad ? " bad" : ""}`} role="status" aria-live="polite">
        {p.status.text}
      </span>
      <span className="grow" />
      <select className="stepsel" aria-label="Funnel step" value={p.pageId} onChange={(e) => p.onStep(e.target.value)}>
        {p.steps.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <div className="seg hide-s" role="group" aria-label="Device">
        {(["d", "t", "m"] as const).map((d) => (
          <button key={d} type="button" aria-pressed={p.dev === d} title={DEV_LABEL[d]} onClick={() => p.onDev(d)}>
            {d === "d" ? "🖥 " : ""}
            {DEV_LABEL[d]}
          </button>
        ))}
      </div>
      <span className="grow" />
      {!p.readOnly && (
        <>
          <button className="btn icon" type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
            ↶
          </button>
          <button className="btn icon" type="button" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo}>
            ↷
          </button>
        </>
      )}
      <button className="btn" type="button" onClick={p.onPreview}>
        Preview
      </button>
      {!p.readOnly && (
        <button className="btn primary" type="button" disabled={p.publishing || p.stopped} onClick={p.onPublish}>
          {p.publishing ? "Publishing…" : "Publish"}
        </button>
      )}
    </header>
  );
}
