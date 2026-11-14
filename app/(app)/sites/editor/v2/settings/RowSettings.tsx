"use client";

import type { Action } from "@/lib/sites/editor-state";
import type { Dev } from "@/lib/sites/editor-settings";
import type { Preset, Row } from "@/lib/sites/tree";
import { Chips, Group, RSlider, SliderField, TextField } from "./controls";

type P = { row: Row; dispatch: (a: Action) => void; dev: Dev };
const PRESETS: [Preset, string][] = [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["1/3+2/3", "⅓ ⅔"], ["2/3+1/3", "⅔ ⅓"]];

export function RowGeneral({ row, dispatch, dev }: P) {
  const up = (patch: Record<string, unknown>) => dispatch({ type: "update", id: row.id, patch });
  return (
    <>
      <Group title="Element">
        <TextField label="Element name" value={row.name} onCommit={(name) => up({ name })} />
      </Group>
      <Group title="Columns">
        <Chips label="Layout" value={row.preset} options={PRESETS} onPick={(preset) => dispatch({ type: "setRowPreset", id: row.id, preset })} />
        <RSlider label="Gap between columns" r={row.gap} dev={dev} min={0} max={80} unit="px" onChange={(gap) => up({ gap })} />
        <Chips label="Vertical align" value={row.valign} options={[["start", "Top"], ["center", "Middle"], ["end", "Bottom"]]} onPick={(valign) => up({ valign })} />
      </Group>
    </>
  );
}

export function RowStyles({ row, dispatch }: Omit<P, "dev">) {
  const up = (patch: Record<string, unknown>) => dispatch({ type: "update", id: row.id, patch });
  return (
    <Group title="Spacing">
      <SliderField label="Margin top" value={row.mt} min={0} max={120} unit="px" onCommit={(mt) => up({ mt })} />
      <SliderField label="Margin bottom" value={row.mb} min={0} max={120} unit="px" onCommit={(mb) => up({ mb })} />
    </Group>
  );
}
