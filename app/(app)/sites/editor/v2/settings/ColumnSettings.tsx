"use client";

import type { Action } from "@/lib/sites/editor-state";
import type { Column } from "@/lib/sites/tree";
import { ColorField, Group, SliderField, SpacingBox, TextField } from "./controls";

type P = { col: Column; dispatch: (a: Action) => void };

export function ColumnGeneral({ col, dispatch }: P) {
  return (
    <>
      <Group title="Element">
        <TextField label="Element name" value={col.name} onCommit={(name) => dispatch({ type: "update", id: col.id, patch: { name } })} />
      </Group>
      <Group title="Column">
        <p className="note">Columns size themselves from the row layout. Change it on the row (blue).</p>
      </Group>
    </>
  );
}

export function ColumnStyles({ col, dispatch }: P) {
  const up = (patch: Record<string, unknown>) => dispatch({ type: "update", id: col.id, patch });
  const p = col.pad;
  return (
    <>
      <Group title="Padding">
        <SpacingBox value={{ pt: p.t, pr: p.r, pb: p.b, pl: p.l }} margin={false} onCommit={(v) => up({ pad: { t: v.pt, r: v.pr, b: v.pb, l: v.pl } })} />
      </Group>
      <Group title="Background &amp; corners">
        <ColorField label="Background" value={col.bg} onCommit={(bg) => up({ bg })} fallback="#ffffff" />
        <SliderField label="Corner radius" value={col.radius} min={0} max={40} unit="px" onCommit={(radius) => up({ radius })} />
      </Group>
    </>
  );
}
