"use client";

// The left flyout: picks the body for the rail button. Editing flyouts are
// inside a disabled <fieldset> in read-only mode.
import type { Page, Popup, Preset, Section, ElementType } from "@/lib/sites/tree";
import AddFlyout, { type AddCat } from "./AddFlyout";
import { LayersFlyout, PagesFlyout, PopupsFlyout } from "./PageFlyouts";
import type { Prebuilt } from "./prebuilt";
import { FLY_TITLE } from "./Rail";
import { BgFlyout, SeoFlyout, TrackFlyout, TypeFlyout } from "./SiteFlyouts";
import type { FlyName, SiteSettingsView, StepInfo, ValueRow } from "./types";
import ValuesFlyout from "./ValuesFlyout";

export type FlyActions = {
  selectNode: (id: string) => void;
  insertSection: (w: Section["width"]) => void;
  insertPrebuilt: (p: Prebuilt) => void;
  insertRow: (p: Preset) => void;
  insertElement: (t: ElementType) => void;
  switchStep: (id: string) => void;
  addStep: (i: { name: string; path: string; kind: "page" | "checkout" | "thank_you" }) => Promise<string | null>;
  editPopup: (id: string) => void;
  addPopup: (name: string) => void;
  updatePopup: (id: string, patch: Partial<Pick<Popup, "name" | "trigger" | "delaySec">>) => void;
  changeSettings: (patch: Partial<SiteSettingsView>) => void;
  editValue: (key: string, value: string) => void;
  createValue: (v: { key: string; label: string; value: string }) => Promise<string | null>;
};

type Props = {
  fly: FlyName | null;
  onClose: () => void;
  readOnly: boolean;
  page: Page;
  popupId: string | null;
  sel: string | null;
  steps: StepInfo[];
  pageId: string;
  basePath: string;
  domain: string;
  path: string;
  settings: SiteSettingsView;
  values: ValueRow[];
  valueMap: Record<string, string>;
  addCat: AddCat;
  onAddCat: (c: AddCat) => void;
  libCat: string | null;
  onLibCat: (c: string) => void;
  a: FlyActions;
};

export default function Flyout(p: Props) {
  const { a } = p;
  let body: React.ReactNode = null;
  const editing = p.fly !== "layers" && p.fly !== "pages";
  switch (p.fly) {
    case "add":
      body = (
        <AddFlyout cat={p.addCat} onCat={p.onAddCat} libCat={p.libCat} onLibCat={p.onLibCat} onSection={a.insertSection} onPrebuilt={a.insertPrebuilt} onRow={a.insertRow} onElement={a.insertElement} />
      );
      break;
    case "layers":
      body = <LayersFlyout page={p.page} popupId={p.popupId} sel={p.sel} onSelect={a.selectNode} />;
      break;
    case "pages":
      body = <PagesFlyout steps={p.steps} pageId={p.pageId} basePath={p.basePath} onSwitch={a.switchStep} onAdd={a.addStep} />;
      break;
    case "type":
      body = <TypeFlyout s={p.settings} onChange={a.changeSettings} />;
      break;
    case "bg":
      body = <BgFlyout s={p.settings} onChange={a.changeSettings} />;
      break;
    case "popups":
      body = <PopupsFlyout popups={p.page.popups} onEdit={a.editPopup} onAdd={a.addPopup} onUpdate={a.updatePopup} />;
      break;
    case "values":
      body = <ValuesFlyout values={p.values} onEdit={a.editValue} onCreate={a.createValue} />;
      break;
    case "seo":
      body = <SeoFlyout s={p.settings} values={p.valueMap} domain={p.domain} path={p.path} onChange={a.changeSettings} />;
      break;
    case "track":
      body = <TrackFlyout s={p.settings} onChange={a.changeSettings} />;
      break;
  }
  return (
    <aside className={`fly${p.fly ? " open" : ""}`} aria-label="Tool panel" inert={!p.fly}>
      {p.fly && (
        <div className="in">
          <h2>
            {FLY_TITLE[p.fly]}
            <button className="x" type="button" aria-label="Close panel" onClick={p.onClose}>
              ×
            </button>
          </h2>
          <div className="body">{editing && p.readOnly ? <fieldset disabled>{body}</fieldset> : body}</div>
        </div>
      )}
    </aside>
  );
}
