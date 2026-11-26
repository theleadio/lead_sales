"use client";

import type { Action } from "@/lib/sites/editor-state";
import { nameError, type Dev } from "@/lib/sites/editor-settings";
import type { Section } from "@/lib/sites/tree";
import { Chips, ColorField, Group, ImageField, RSlider, TextField } from "./controls";

type P = { sec: Section; dispatch: (a: Action) => void; dev: Dev };
const HIDE: ["d" | "t" | "m", string][] = [["d", "Desktop"], ["t", "Tablet"], ["m", "Phone"]];

export function SectionGeneral({ sec, dispatch }: Omit<P, "dev">) {
  const up = (patch: Record<string, unknown>) => dispatch({ type: "update", id: sec.id, patch });
  return (
    <>
      <Group title="Element">
        <TextField label="Element name" value={sec.name} onCommit={(name) => up({ name })} validate={nameError} />
      </Group>
      <Group title="Link target">
        <TextField
          label="Anchor name"
          value={sec.anchor ?? ""}
          onCommit={(v) => up({ anchor: v === "" ? undefined : v })}
          validate={(v) => (v === "" || /^[a-z][a-z0-9-]{0,39}$/.test(v) ? null : "Use lowercase letters, digits and dashes, starting with a letter")}
          placeholder="pricing"
          hint={sec.anchor ? `Menu items and buttons can link here with #${sec.anchor}` : "Name this section so a menu item or button can scroll to it, e.g. #pricing."}
        />
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
        <ImageField label="Background image address" value={sec.bgImage ?? ""} onCommit={(v) => up({ bgImage: v === "" ? undefined : v })} />
      </Group>
      <Group title="Spacing">
        <RSlider label="Padding top" r={sec.pt} dev={dev} min={0} max={200} unit="px" onChange={(pt) => up({ pt })} />
        <RSlider label="Padding bottom" r={sec.pb} dev={dev} min={0} max={200} unit="px" onChange={(pb) => up({ pb })} />
      </Group>
    </>
  );
}
