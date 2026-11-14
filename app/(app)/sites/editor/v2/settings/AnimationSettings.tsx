"use client";

import type { Action } from "@/lib/sites/editor-state";
import { Group, SelectField } from "./controls";

type Anim = "none" | "fade" | "up" | "left" | "zoom";
const OPTS: [Anim, string][] = [["none", "None"], ["fade", "Fade in"], ["up", "Slide up"], ["left", "Slide in from left"], ["zoom", "Zoom in"]];
const FROM: Record<Anim, Keyframe> = {
  none: { opacity: 0, transform: "translateY(28px)" },
  fade: { opacity: 0 },
  up: { opacity: 0, transform: "translateY(28px)" },
  left: { opacity: 0, transform: "translateX(-28px)" },
  zoom: { opacity: 0, transform: "scale(.94)" },
};

/** Editor-only: replay the entrance on the canvas node (Web Animations API inside the iframe). */
function preview(id: string, anim: Anim) {
  const doc = document.querySelector<HTMLIFrameElement>('iframe[title="Page canvas"]')?.contentDocument;
  const n = doc?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
  n?.animate([FROM[anim], { opacity: 1, transform: "none" }], { duration: 700, easing: "ease" });
}

export function AnimationSettings({ id, kind, anim, dispatch }: { id: string; kind: string; anim: Anim; dispatch: (a: Action) => void }) {
  if (kind !== "sec" && kind !== "el") return <div className="empty">Animations are set on sections and elements.</div>;
  return (
    <Group title="Entrance animation">
      <SelectField label="Animation" value={anim} options={OPTS} onPick={(v) => dispatch({ type: "update", id, patch: { anim: v } })} />
      <button className="btn" type="button" onClick={() => preview(id, anim)}>
        ▶ Preview animation
      </button>
      <p className="note">Plays once when the visitor scrolls to it. Turned off for visitors who ask their device for reduced motion.</p>
    </Group>
  );
}
