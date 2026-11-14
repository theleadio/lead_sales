"use client";

// MOUNT POINT for Task 6's settings panel (General / Styles / Animations).
// Placeholder: shows the selected item's kind and name, or the empty state.
// Task 6 replaces the body of this component and keeps the props:
//   state.page / state.sel   what to edit
//   dispatch({type:"update", id, patch}) etc.   how to edit it (editor-state reducers)
//   dev                      which device's responsive value to edit
import type { EditorState, Node } from "@/lib/sites/editor-state";
import { findPath } from "@/lib/sites/editor-state";
import type { Action } from "@/lib/sites/editor-state";
import { KIND_COLOR, KIND_NAME, type Dev } from "./types";

export type RightPanelProps = {
  state: EditorState;
  dispatch: (a: Action) => void;
  dev: Dev;
  readOnly: boolean;
  open: boolean;
  onClose: () => void;
};

export default function RightPanel({ state, open, onClose }: RightPanelProps) {
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
          <div className="sbody">
            <p className="empty" data-testid="settings-placeholder">
              <b>{KIND_NAME[node.kind]}</b>
              <br />
              {node.name}
              <br />
              <span className="note">Settings for this {KIND_NAME[node.kind].toLowerCase()} arrive with the next step of the editor.</span>
            </p>
          </div>
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
