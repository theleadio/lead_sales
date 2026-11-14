"use client";

// Controls for the settings panel. Text/number/colour inputs keep a local
// draft and commit after ~400 ms of quiet or on blur (one undo step per
// gesture); chips, selects and toggles commit immediately.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { R } from "@/lib/sites/elements";
import { clamp, hex6, isSetR, moveItem, readR, resetR, validHex, writeR, type Dev } from "@/lib/sites/editor-settings";

export const DEBOUNCE_MS = 400;

/** Local draft + debounced commit. While the control has focus its draft is authoritative. */
export function useDraft<T>(value: T, commit: (v: T) => void, ms = DEBOUNCE_MS) {
  const key = JSON.stringify(value);
  const [draft, setDraft] = useState<T>(value);
  const [prevKey, setPrevKey] = useState(key);
  const [focused, setFocused] = useState(false);
  if (key !== prevKey) {
    setPrevKey(key);
    if (!focused) setDraft(value);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ v: T } | null>(null);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) commitRef.current(p.v);
  };
  useEffect(() => flush, []);
  const set = (v: T, now = false) => {
    setDraft(v);
    pending.current = { v };
    if (timer.current) clearTimeout(timer.current);
    if (now) flush();
    else timer.current = setTimeout(flush, ms);
  };
  return {
    draft,
    set,
    focus: {
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false);
        flush();
      },
    },
  };
}

export function Group({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="grp" open={open}>
      <summary>{title}</summary>
      <div className="gb">{children}</div>
    </details>
  );
}

const DEV_TAG: Record<Dev, string> = { d: "Desktop", t: "Tablet", m: "Phone" };
const DEV_ICON: Record<Dev, string> = { d: "🖥", t: "Tablet", m: "📱" };
export const DevTag = ({ dev }: { dev: Dev }) => (
  <span className="dev" title={`This value is for ${DEV_TAG[dev].toLowerCase()}`}>
    {DEV_ICON[dev]}
  </span>
);

export const ErrText = ({ id, msg }: { id?: string; msg: string | null | undefined }) =>
  msg ? (
    <span className="err" id={id} role="alert">
      {msg}
    </span>
  ) : null;

export function TextField({
  label, value, onCommit, validate, hint, multiline, rows = 4, type = "text", placeholder, mono,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  validate?: (v: string) => string | null;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  type?: "text" | "date" | "datetime-local";
  placeholder?: string;
  mono?: boolean;
}) {
  const eid = useId();
  const { draft, set, focus } = useDraft(value, (v) => {
    if (!validate?.(v)) onCommit(v);
  });
  const err = validate?.(draft) ?? null;
  const common = {
    id: eid,
    className: "inp2" + (err ? " bad" : ""),
    value: draft,
    placeholder,
    "aria-invalid": err ? true : undefined,
    "aria-describedby": err ? eid + "e" : undefined,
    style: mono ? { fontFamily: "ui-monospace,monospace" } : undefined,
    ...focus,
  };
  return (
    <div className="f">
      <label htmlFor={eid}>
        <span>{label}</span>
      </label>
      {multiline ? (
        <textarea {...common} rows={rows} onChange={(e) => set(e.target.value)} />
      ) : (
        <input {...common} type={type} onChange={(e) => set(e.target.value, type !== "text")} />
      )}
      <ErrText id={eid + "e"} msg={err} />
      {hint && <span className="note">{hint}</span>}
    </div>
  );
}

export function SelectField<T extends string>({
  label, value, options, onPick,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="f">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <select id={id} className="inp2" value={value} onChange={(e) => onPick(e.target.value as T)}>
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Chips<T extends string>({
  label, value, options, onPick,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
}) {
  return (
    <div className="f" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="chips">
        {options.map(([k, v]) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onPick(k)}>
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="chk">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Slider + number + unit for a plain number. */
export function SliderField({
  label, value, min, max, unit, onCommit, tag, dim, onReset, step = 1,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onCommit: (v: number) => void;
  tag?: ReactNode;
  dim?: boolean;
  onReset?: () => void;
  step?: number;
}) {
  const { draft, set, focus } = useDraft(value, onCommit);
  const [text, setText] = useState<string | null>(null); // while typing in the number box
  return (
    <div className={"f" + (dim ? " dim" : "")} role="group" aria-label={label}>
      <span>
        {label}
        {tag}
        {onReset && (
          <button type="button" className="rst" aria-label={`Reset ${label} to desktop value`} title="Reset to desktop" onClick={onReset}>
            ×
          </button>
        )}
      </span>
      <div className="slider">
        <input type="range" min={min} max={max} step={step} value={draft} aria-label={label} {...focus} onChange={(e) => { setText(null); set(Number(e.target.value)); }} />
        <div className="unit">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={text ?? String(draft)}
            aria-label={`${label} value`}
            onFocus={focus.onFocus}
            onBlur={() => { setText(null); focus.onBlur(); }}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n)) set(clamp(n, min, max));
            }}
          />
          <em>{unit}</em>
        </div>
      </div>
    </div>
  );
}

/** Slider for a responsive value R: edits the current device, shows the inherited value dimmed on tablet/phone. */
export function RSlider({
  label, r, dev, min, max, unit, onChange,
}: {
  label: string;
  r: R;
  dev: Dev;
  min: number;
  max: number;
  unit: string;
  onChange: (r: R) => void;
}) {
  const own = isSetR(r, dev);
  return (
    <SliderField
      label={label}
      value={readR(r, dev)}
      min={min}
      max={max}
      unit={unit}
      tag={<DevTag dev={dev} />}
      dim={!own}
      onReset={own && dev !== "d" ? () => onChange(resetR(r, dev)) : undefined}
      onCommit={(v) => onChange(writeR(r, dev, v))}
    />
  );
}

/** Colour swatch + hex text. Invalid hex is shown but never committed. "" = inherit. */
export function ColorField({
  label, value, onCommit, fallback = "#111827", clearable = true,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  fallback?: string;
  clearable?: boolean;
}) {
  const id = useId();
  const { draft, set, focus } = useDraft(value, (v) => {
    if (v === "" || validHex(v)) onCommit(v);
  });
  const bad = draft !== "" && !validHex(draft);
  return (
    <div className="f">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="sw">
        <input type="color" aria-label={`${label} picker`} value={hex6(draft, fallback)} onChange={(e) => set(e.target.value, true)} />
        <input
          id={id}
          className={"inp2" + (bad ? " bad" : "")}
          value={draft}
          placeholder={clearable ? "inherit" : fallback}
          maxLength={7}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? id + "e" : undefined}
          onChange={(e) => set(e.target.value)}
          {...focus}
        />
        {clearable && draft !== "" && (
          <button type="button" className="rst" aria-label={`Clear ${label}`} title="Clear" onClick={() => set("", true)}>
            ×
          </button>
        )}
      </div>
      <ErrText id={id + "e"} msg={bad ? "Use a hex colour such as #1a2b3c" : null} />
    </div>
  );
}

type Sp = { mt?: number; mb?: number; pt: number; pr: number; pb: number; pl: number };
/** Visual margin/padding box. Outer = margin (when given), inner = padding. */
export function SpacingBox({ value, margin, onCommit }: { value: Sp; margin: boolean; onCommit: (v: Sp) => void }) {
  const { draft, set, focus } = useDraft(value, onCommit);
  const inp = (k: keyof Sp, aria: string) => (
    <input
      type="number"
      min={0}
      max={400}
      value={draft[k] ?? 0}
      aria-label={aria}
      {...focus}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) set({ ...draft, [k]: clamp(n, 0, 400) });
      }}
    />
  );
  return (
    <div>
      <div className="box">
        <span className="lbl">{margin ? "MARGIN" : ""}</span>
        <span />
        {margin ? inp("mt", "Margin top") : <span />}
        <span />
        <span>{margin ? "—" : ""}</span>
        <div className="inner">
          <span />
          {inp("pt", "Padding top")}
          <span />
          {inp("pl", "Padding left")}
          <div className="core" />
          {inp("pr", "Padding right")}
          <span />
          {inp("pb", "Padding bottom")}
          <span />
        </div>
        <span>{margin ? "—" : ""}</span>
        <span />
        {margin ? inp("mb", "Margin bottom") : <span />}
        <span />
      </div>
      <p className="note">{margin ? "Inner box is padding, outer is margin (px)." : "Padding inside the column (px)."}</p>
    </div>
  );
}

/** Add / remove / reorder rows of a list (FAQ, links, images). */
export function ListEditor<T>({
  label, items, onChange, blank, addLabel, max, row, itemLabel,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  blank: () => T;
  addLabel: string;
  max: number;
  itemLabel: string;
  row: (item: T, i: number, set: (v: T) => void) => ReactNode;
}) {
  return (
    <div className="f" role="group" aria-label={label}>
      {items.map((it, i) => (
        <div className="lrow" key={i}>
          <div className="lhead">
            <b>
              {itemLabel} {i + 1}
            </b>
            <span className="grow" />
            <button type="button" aria-label={`Move ${itemLabel} ${i + 1} up`} disabled={i === 0} onClick={() => onChange(moveItem(items, i, i - 1))}>
              ↑
            </button>
            <button type="button" aria-label={`Move ${itemLabel} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, i + 1))}>
              ↓
            </button>
            <button type="button" aria-label={`Remove ${itemLabel} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
          {row(it, i, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
        </div>
      ))}
      <button className="btn" type="button" disabled={items.length >= max} onClick={() => onChange([...items, blank()])}>
        {addLabel}
      </button>
    </div>
  );
}

/** Controlled input: the parent owns the draft (used where several fields commit as one object). */
export function InputField({
  label, value, onChange, error, type = "text", onFocus, onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  type?: "text" | "date";
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const id = useId();
  return (
    <div className="f">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <input
        id={id}
        type={type}
        className={"inp2" + (error ? " bad" : "")}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? id + "e" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <ErrText id={id + "e"} msg={error} />
    </div>
  );
}
