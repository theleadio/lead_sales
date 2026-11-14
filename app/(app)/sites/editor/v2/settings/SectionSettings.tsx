"use client";

import type { Action } from "@/lib/sites/editor-state";
import { imageUrlError, type Dev } from "@/lib/sites/editor-settings";
import type { Section } from "@/lib/sites/tree";
import { Chips, ColorField, Group, RSlider, TextField } from "./controls";

type P = { sec: Section; dispatch: (a: Action) => void; dev: Dev };
const HIDE: ["d" | "t" | "m", string][] = [["d", "Desktop"], ["t", "Tablet"], ["m", "Phone"]];

export function SectionGeneral({ sec, dispatch }: Omit<P, "dev">) {
  const up = (patch: Record<string, unknown>) => dispatch({ type: "update", id: sec.id, patch });
  return (
    <>
      <Group title="Element">
        <TextField label="Element name" value={sec.name} onCommit={(name) => up({ name })} />
      </Group>
      <Group title="Layout">
        <Chips label="Section width" value={sec.width} options={[["full", "Full"], ["wide", "Wide"], ["medium", "Medium"], ["small", "Small"]]} onPick={(width) => up({ width })} />
        <div className="f" role="group" aria-label="Hide on">
          <span>Hide on</span>
          <div className="chips">
            {HIDE.map(([d, l]) => (
              <button key={d} type="button" aria-pressed={sec.hideOn[d]} onClick={() => up({ hideOn: { ...sec.hideOn, [d]: !sec.hideOn[d] } })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </Group>
    </>
  );
}

export function SectionStyles({ sec, dispatch, dev }: P) {
  const up = (patch: Record<string, unknown>) => dispatch({ type: "update", id: sec.id, patch });
  return (
    <>
      <Group title="Background">
        <ColorField label="Background colour" value={sec.bg} onCommit={(bg) => up({ bg })} fallback="#ffffff" />
        <TextField label="Background image address" value={sec.bgImage ?? ""} onCommit={(v) => up({ bgImage: v === "" ? undefined : v })} validate={imageUrlError} placeholder="https://… or /path" />
      </Group>
      <Group title="Spacing">
        <RSlider label="Padding top" r={sec.pt} dev={dev} min={0} max={200} unit="px" onChange={(pt) => up({ pt })} />
        <RSlider label="Padding bottom" r={sec.pb} dev={dev} min={0} max={200} unit="px" onChange={(pb) => up({ pb })} />
      </Group>
    </>
  );
}
