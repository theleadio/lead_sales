"use client";

// Right-hand settings panel shell: title in the kind colour, then SettingsPanel (tabs) or the empty state.
import type { EditorState, Node } from "@/lib/sites/editor-state";
import { findPath } from "@/lib/sites/editor-state";
import type { Action } from "@/lib/sites/editor-state";
import SettingsPanel from "./SettingsPanel";
import { KIND_COLOR, type Dev, type ClassOpt, type StepInfo } from "./types";

export type RightPanelProps = {
  state: EditorState;
  dispatch: (a: Action) => void;
  dev: Dev;
  steps: StepInfo[];
  classes: ClassOpt[];
  readOnly: boolean;
  open: boolean;
  onClose: () => void;
};

export default function RightPanel({ state, dispatch, dev, steps, classes, readOnly, open, onClose }: RightPanelProps) {
  const node: Node | undefined = state.sel ? findPath(state.page, state.sel)?.node : undefined;
  return (
    <aside className={`side${open ? "" : " closed"}`} aria-label="Settings" style={node ? ({ ["--c" as string]: KIND_COLOR[node.kind] } as React.CSSProperties) : undefined}>
      {node ? (
        <>
          <h2>
            <span className="dot" />
            <span className="grow">{node.kind === "sec" ? "Section" : node.name}</span>
            <button className="x" type="button" aria-label="Close settings" onClick={onClose}>
              ×
            </button>
          </h2>
          <SettingsPanel key={node.id} node={node} page={state.page} dispatch={dispatch} dev={dev} steps={steps} classes={classes} readOnly={readOnly} />
        </>
      ) : (
        <>
          <h2>
            <span className="grow">Settings</span>
          </h2>
          <div className="empty">
            <b>Nothing selected</b>
            <br />
            Click any section, row, column or element on the page. Its settings appear here.
            <br />
            <br />
            <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ color: "var(--sec)" }}>■ Section</span>
              <span style={{ color: "var(--row)" }}>■ Row</span>
              <span style={{ color: "var(--col)" }}>■ Column</span>
              <span style={{ color: "var(--el)" }}>■ Element</span>
            </span>
            <br />
            <br />
            Double-click text to type on the page.
          </div>
        </>
      )}
    </aside>
  );
}
