"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- props are validated by the per-type zod schema before every commit */

// Element settings: General (per type) and Styles (box). Every commit is
// validated with the element's props schema first; props are sent whole.
import { useEffect, useRef, useState } from "react";
import type { Action } from "@/lib/sites/editor-state";
import { elementPropsSchema, type Element, type Popup } from "@/lib/sites/tree";
import { fromLines, httpsOnlyError, imageUrlError, toLines, urlError, type Dev } from "@/lib/sites/editor-settings";
import type { StepInfo } from "../types";
import { Chips, ColorField, ErrText, Group, ListEditor, RSlider, SelectField, SliderField, SpacingBox, TextField } from "./controls";
import { LeadFormBlock, OrderFormBlock } from "./FormSettings";

type Set = (patch: Record<string, unknown>) => void;
type C = { p: any; set: Set; dev: Dev; popups: Popup[]; steps: StepInfo[] };

const ALIGN: ["left" | "center" | "right", string][] = [["left", "Left"], ["center", "Center"], ["right", "Right"]];

function Typo({ c, min = 10, max = 96 }: { c: C; min?: number; max?: number }) {
  const { p, set, dev } = c;
  const weights: [string, string][] = [["400", "400 - Regular"], ["600", "600 - Semi-Bold"], ["700", "700 - Bold"], ["800", "800 - Extra-Bold"]];
  if (!weights.some(([k]) => k === String(p.weight))) weights.push([String(p.weight), String(p.weight)]);
  return (
    <>
      <Group title="Typography">
        <SelectField label="Typography type" value={p.font} options={[["hf", "Headline font"], ["cf", "Content font"]]} onPick={(font) => set({ font })} />
        <RSlider label="Font size" r={p.size} dev={dev} min={min} max={max} unit="px" onChange={(size) => set({ size })} />
        <SelectField label="Font weight" value={String(p.weight)} options={weights} onPick={(w) => set({ weight: Number(w) })} />
        <Chips label="Alignment" value={p.align} options={ALIGN} onPick={(align) => set({ align })} />
      </Group>
      <Group title="Colour">
        <ColorField label="Text colour" value={p.color} onCommit={(color) => set({ color })} />
        <p className="note">Double-click the text on the page to edit it. Use <b>{"{ }"}</b> in the text toolbar to insert a custom value.</p>
      </Group>
    </>
  );
}

function ButtonBlock({ c }: { c: C }) {
  const { p, set, dev, popups } = c;
  return (
    <>
      <Group title="Button">
        <TextField label="Text" value={p.text} onCommit={(text) => set({ text })} />
        <TextField label="Sub-text" value={p.sub} onCommit={(sub) => set({ sub })} hint="Small line under the main text, e.g. “Limited seats”." />
        <SelectField
          label="When clicked"
          value={p.action}
          options={[["form", "Scroll to this page's form"], ["next", "Go to next funnel step"], ["popup", "Open a popup"], ["url", "Open a website"]]}
          onPick={(action) => set(action === "popup" ? { action, popupId: p.popupId ?? popups[0]?.id } : { action })}
        />
        {p.action === "popup" &&
          (popups.length ? (
            <SelectField label="Popup" value={p.popupId ?? ""} options={[...(p.popupId ? [] : [["", "Choose a popup"] as [string, string]]), ...popups.map((x) => [x.id, x.name] as [string, string])]} onPick={(popupId) => set({ popupId })} />
          ) : (
            <p className="note">This page has no popups yet. Add one from the Popups panel on the left.</p>
          ))}
        {p.action === "url" && <TextField label="Website address" value={p.url} onCommit={(url) => set({ url })} validate={httpsOnlyError} placeholder="https://" />}
      </Group>
      <Group title="Look">
        <ColorField label="Background" value={p.bg} onCommit={(bg) => set({ bg })} fallback="#facc15" />
        <ColorField label="Text" value={p.fg} onCommit={(fg) => set({ fg })} />
        <RSlider label="Font size" r={p.size} dev={dev} min={12} max={32} unit="px" onChange={(size) => set({ size })} />
        <Chips label="Alignment" value={p.align} options={ALIGN} onPick={(align) => set({ align })} />
        <Chips label="Width" value={p.full ? "full" : "fit"} options={[["fit", "Fit text"], ["full", "Full width"]]} onPick={(v) => set({ full: v === "full" })} />
      </Group>
    </>
  );
}

const NETWORKS = ["facebook", "instagram", "youtube", "linkedin", "tiktok", "x", "whatsapp"].map((n) => [n, n[0].toUpperCase() + n.slice(1)] as [string, string]);
const ICONS = ["check", "star", "heart", "arrow", "phone", "mail"].map((n) => [n, n[0].toUpperCase() + n.slice(1)] as [string, string]);

function ImageList({ c, title, many }: { c: C; title: string; many: string }) {
  const { p, set } = c;
  return (
    <Group title={title}>
      <ListEditor
        label={title}
        itemLabel={many}
        items={p.items as { src: string; alt: string }[]}
        onChange={(items) => set({ items })}
        blank={() => ({ src: "", alt: "" })}
        addLabel={`＋ Add ${many.toLowerCase()}`}
        max={30}
        row={(it, i, upd) => (
          <>
            <TextField label={`${many} ${i + 1} address`} value={it.src} onCommit={(src) => upd({ ...it, src })} validate={imageUrlError} placeholder="https://" />
            <TextField label={`${many} ${i + 1} description`} value={it.alt} onCommit={(alt) => upd({ ...it, alt })} />
          </>
        )}
      />
    </Group>
  );
}

function General({ el, c }: { el: Element; c: C }) {
  const { p, set, dev } = c;
  switch (el.type) {
    case "headline":
    case "sub":
    case "para":
      return <Typo c={c} />;
    case "list":
      return (
        <Group title="Items">
          <TextField label="One item per line" multiline rows={5} value={toLines(p.items)} onCommit={(v) => set({ items: fromLines(v) })} />
          <RSlider label="Font size" r={p.size} dev={dev} min={12} max={28} unit="px" onChange={(size) => set({ size })} />
          <ColorField label="Text colour" value={p.color} onCommit={(color) => set({ color })} />
        </Group>
      );
    case "button":
      return <ButtonBlock c={c} />;
    case "image":
      return (
        <Group title="Image">
          <TextField label="Image address" value={p.src} onCommit={(src) => set({ src })} validate={imageUrlError} placeholder="https://… or /path" />
          <TextField label="Alt text (for screen readers & SEO)" value={p.alt} onCommit={(alt) => set({ alt })} />
          <TextField label="Link when clicked (optional)" value={p.link} onCommit={(link) => set({ link })} validate={urlError} />
          <Chips label="Alignment" value={p.align} options={ALIGN} onPick={(align) => set({ align })} />
        </Group>
      );
    case "video":
      return (
        <Group title="Video">
          <TextField label="YouTube or Vimeo link" value={p.url} onCommit={(url) => set({ url })} validate={urlError} placeholder="https://" />
        </Group>
      );
    case "form":
      return (
        <>
          <LeadFormBlock settings={p.settings} steps={c.steps} onCommit={(settings) => set({ settings })} />
          <Group title="Button">
            <TextField label="Button text" value={p.button} onCommit={(button) => set({ button })} />
          </Group>
        </>
      );
    case "order":
      return (
        <>
          <OrderFormBlock settings={p.settings} onCommit={(settings) => set({ settings })} />
          <Group title="Button">
            <TextField label="Button text" value={p.button} onCommit={(button) => set({ button })} />
          </Group>
        </>
      );
    case "faq":
      return (
        <Group title="Questions">
          <ListEditor
            label="Questions"
            itemLabel="Question"
            items={p.items as [string, string][]}
            onChange={(items) => set({ items })}
            blank={() => ["[Question]", "[Placeholder answer]"]}
            addLabel="＋ Add question"
            max={50}
            row={([q, a], i, upd) => (
              <>
                <TextField label={`Question ${i + 1} text`} value={q} onCommit={(v) => upd([v, a])} />
                <TextField label={`Answer ${i + 1}`} multiline rows={2} value={a} onCommit={(v) => upd([q, v])} />
              </>
            )}
          />
        </Group>
      );
    case "countdown":
      return (
        <Group title="Countdown">
          <TextField label="Counts down to" type="datetime-local" value={p.to} onCommit={(to) => set({ to })} />
          <TextField label="Text when finished (optional)" value={p.doneText} onCommit={(doneText) => set({ doneText })} />
        </Group>
      );
    case "divider":
      return (
        <Group title="Divider">
          <ColorField label="Line colour" value={p.color} onCommit={(color) => set({ color })} fallback="#e5e7eb" />
          <SliderField label="Thickness" value={p.thickness} min={1} max={20} unit="px" onCommit={(thickness) => set({ thickness })} />
        </Group>
      );
    case "icon-text":
      return (
        <Group title="Icon and text">
          <SelectField label="Icon" value={p.icon} options={ICONS.some(([k]) => k === p.icon) ? ICONS : [...ICONS, [p.icon, p.icon]]} onPick={(icon) => set({ icon })} />
          <RSlider label="Font size" r={p.size} dev={dev} min={10} max={60} unit="px" onChange={(size) => set({ size })} />
          <ColorField label="Text colour" value={p.color} onCommit={(color) => set({ color })} />
          <p className="note">Double-click the text on the page to edit it.</p>
        </Group>
      );
    case "social":
      return (
        <>
          <Group title="Links">
            <ListEditor
              label="Social links"
              itemLabel="Link"
              items={p.items as { network: string; url: string }[]}
              onChange={(items) => set({ items })}
              blank={() => ({ network: "facebook", url: "" })}
              addLabel="＋ Add link"
              max={10}
              row={(it, i, upd) => (
                <>
                  <SelectField label={`Link ${i + 1} network`} value={it.network} options={NETWORKS} onPick={(network) => upd({ ...it, network })} />
                  <TextField label={`Link ${i + 1} address`} value={it.url} onCommit={(url) => upd({ ...it, url })} validate={urlError} placeholder="https://" />
                </>
              )}
            />
          </Group>
          <Group title="Look">
            <RSlider label="Icon size" r={p.size} dev={dev} min={12} max={64} unit="px" onChange={(size) => set({ size })} />
            <Chips label="Alignment" value={p.align} options={ALIGN} onPick={(align) => set({ align })} />
          </Group>
        </>
      );
    case "logos":
      return (
        <>
          <ImageList c={c} title="Logos" many="Logo" />
          <Group title="Look">
            <RSlider label="Logo height" r={p.height} dev={dev} min={16} max={160} unit="px" onChange={(height) => set({ height })} />
          </Group>
        </>
      );
    case "slider":
      return (
        <>
          <ImageList c={c} title="Slides" many="Slide" />
          <Group title="Behaviour">
            <Chips label="Autoplay" value={p.autoplay ? "on" : "off"} options={[["off", "Off"], ["on", "On"]]} onPick={(v) => set({ autoplay: v === "on" })} />
          </Group>
        </>
      );
    case "counter":
      return (
        <Group title="Counter">
          <TextField label="Counts up to" value={String(p.to)} onCommit={(v) => set({ to: Number(v) })} validate={(v) => (v.trim() !== "" && Number.isFinite(Number(v)) ? null : "Enter a number")} />
          <TextField label="Prefix" value={p.prefix} onCommit={(prefix) => set({ prefix })} />
          <TextField label="Suffix" value={p.suffix} onCommit={(suffix) => set({ suffix })} />
          <TextField label="Label" value={p.label} onCommit={(label) => set({ label })} />
          <RSlider label="Font size" r={p.size} dev={dev} min={16} max={120} unit="px" onChange={(size) => set({ size })} />
          <ColorField label="Text colour" value={p.color} onCommit={(color) => set({ color })} />
        </Group>
      );
    case "nav":
      return (
        <>
          <Group title="Menu links">
            <ListEditor
              label="Menu links"
              itemLabel="Link"
              items={p.items as { label: string; href: string }[]}
              onChange={(items) => set({ items })}
              blank={() => ({ label: "[Link]", href: "#" })}
              addLabel="＋ Add link"
              max={20}
              row={(it, i, upd) => (
                <>
                  <TextField label={`Link ${i + 1} text`} value={it.label} onCommit={(label) => upd({ ...it, label })} />
                  <TextField label={`Link ${i + 1} address`} value={it.href} onCommit={(href) => upd({ ...it, href })} validate={urlError} />
                </>
              )}
            />
          </Group>
          <Group title="Look">
            <Chips label="Alignment" value={p.align} options={ALIGN} onPick={(align) => set({ align })} />
            <ColorField label="Text colour" value={p.color} onCommit={(color) => set({ color })} />
          </Group>
        </>
      );
  }
}

export function ElementGeneral({ el, dispatch, dev, popups, steps }: { el: Element; dispatch: (a: Action) => void; dev: Dev; popups: Popup[]; steps: StepInfo[] }) {
  const latest = useRef<any>(el.props);
  useEffect(() => {
    latest.current = el.props;
  }, [el.props]);
  const [err, setErr] = useState<string | null>(null);
  const set: Set = (patch) => {
    const next = { ...latest.current, ...patch };
    const r = elementPropsSchema(el.type).safeParse(next);
    if (!r.success) {
      setErr(`Not saved: ${r.error.issues[0]?.message ?? "invalid value"}`);
      return;
    }
    setErr(null);
    latest.current = next;
    dispatch({ type: "update", id: el.id, patch: { props: next } });
  };
  return (
    <>
      <Group title="Element">
        <TextField label="Element name" value={el.name} onCommit={(name) => dispatch({ type: "update", id: el.id, patch: { name } })} />
      </Group>
      <General el={el} c={{ p: el.props, set, dev, popups, steps }} />
      <ErrText msg={err} />
    </>
  );
}

export function ElementStyles({ el, dispatch }: { el: Element; dispatch: (a: Action) => void }) {
  const box = el.box;
  const put = (patch: Partial<typeof box>) => dispatch({ type: "update", id: el.id, patch: { box: { ...box, ...patch } } });
  return (
    <>
      <Group title="Margin &amp; padding">
        <SpacingBox value={box} margin onCommit={(v) => put({ mt: v.mt ?? 0, mb: v.mb ?? 0, pt: v.pt, pr: v.pr, pb: v.pb, pl: v.pl })} />
      </Group>
      <Group title="Background &amp; corners">
        <ColorField label="Background" value={box.bg} onCommit={(bg) => put({ bg })} fallback="#ffffff" />
        <SliderField label="Corner radius" value={box.radius} min={0} max={40} unit="px" onCommit={(radius) => put({ radius })} />
      </Group>
    </>
  );
}
