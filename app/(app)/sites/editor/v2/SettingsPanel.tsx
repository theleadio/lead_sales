"use client";

// Settings panel body: tabs (General / Styles / Animations) for the selected node.
// Keyed by node id so drafts never leak between selections.
import { useState } from "react";
import type { Action, Node } from "@/lib/sites/editor-state";
import type { Page } from "@/lib/sites/tree";
import { AnimationSettings } from "./settings/AnimationSettings";
import { ColumnGeneral, ColumnStyles } from "./settings/ColumnSettings";
import { ElementGeneral, ElementStyles } from "./settings/ElementSettings";
import { RowGeneral, RowStyles } from "./settings/RowSettings";
import { SectionGeneral, SectionStyles } from "./settings/SectionSettings";
import type { ClassOpt, Dev, StepInfo } from "./types";

type Tab = "general" | "styles" | "animations";
const TABS: [Tab, string][] = [["general", "General"], ["styles", "Styles"], ["animations", "Animations"]];

export default function SettingsPanel({ node, page, dispatch, dev, steps, classes, readOnly }: { node: Node; page: Page; dispatch: (a: Action) => void; dev: Dev; steps: StepInfo[]; classes: ClassOpt[]; readOnly: boolean }) {
  const [tab, setTab] = useState<Tab>("general");
  let body;
  if (tab === "general") {
    body =
      node.kind === "sec" ? <SectionGeneral sec={node} dispatch={dispatch} />
      : node.kind === "row" ? <RowGeneral row={node} dispatch={dispatch} dev={dev} />
      : node.kind === "col" ? <ColumnGeneral col={node} dispatch={dispatch} />
      : <ElementGeneral el={node} dispatch={dispatch} dev={dev} popups={page.popups} steps={steps} classes={classes} />;
  } else if (tab === "styles") {
    body =
      node.kind === "sec" ? <SectionStyles sec={node} dispatch={dispatch} dev={dev} />
      : node.kind === "row" ? <RowStyles row={node} dispatch={dispatch} />
      : node.kind === "col" ? <ColumnStyles col={node} dispatch={dispatch} />
      : <ElementStyles el={node} dispatch={dispatch} />;
  } else {
    body = <AnimationSettings id={node.id} kind={node.kind} anim={node.kind === "sec" || node.kind === "el" ? node.anim : "none"} dispatch={dispatch} />;
  }
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="settings-panel" onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="sbody" id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <fieldset disabled={readOnly} className="sfs" key={node.id}>
          {body}
        </fieldset>
      </div>
    </>
  );
}
