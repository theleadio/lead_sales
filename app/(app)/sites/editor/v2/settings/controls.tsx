"use client";

// Controls for the settings panel. Text/number/colour inputs keep a local
// draft and commit after ~400 ms of quiet or on blur (one undo step per
// gesture); chips, selects and toggles commit immediately.
import { useEffect, useId, useState, type ReactNode } from "react";
import type { R } from "@/lib/sites/elements";
import { clamp, hex6, imageUrlError, isSetR, makeDebouncer, moveItem, readR, registerFlusher, resetR, validHex, writeR, type Dev } from "@/lib/sites/editor-settings";

export const DEBOUNCE_MS = 400;

/** Local draft + debounced commit. While the control has focus its draft is authoritative. */
export function useDraft<T>(value: T, commit: (v: T) => void, ms = DEBOUNCE_MS, scope = "") {
  const commitCaptured = commit;
  const key = JSON.stringify(value);
  const [draft, setDraft] = useState<T>(value);
  const [prevKey, setPrevKey] = useState(key);
  const [focused, setFocused] = useState(false);
  if (key !== prevKey) {
    setPrevKey(key);
    if (!focused) setDraft(value);
  }
  const [deb] = useState(() => makeDebouncer<T>(ms));
  // flush on unmount, and before undo/redo (flushAll)
  useEffect(() => registerFlusher(deb.flush), [deb]);
  useEffect(() => deb.flush, [deb]);
  // the commit captured now (this render's device/node), not at flush time
  const set = (v: T, now = false) => {
    setDraft(v);
    deb.set(v, commitCaptured, now, scope);
  };
  return {
    draft,
    set,
    focus: {
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false);
        deb.flush();
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

/** Number box that lets you clear and retype: the typed text is kept until blur. */
export function NumInput({ value, min, max, onValue, label, onFocus, onBlur, step = 1 }: {
  value: number; min: number; max: number; onValue: (n: number) => void; label: string; onFocus?: () => void; onBlur?: () => void; step?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text ?? String(value)}
      aria-label={label}
      onFocus={onFocus}
      onBlur={() => { setText(null); onBlur?.(); }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n)) onValue(clamp(n, min, max));
      }}
    />
  );
}

/** Slider + number + unit for a plain number. */
export function SliderField({
  label, value, min, max, unit, onCommit, tag, dim, onReset, step = 1, scope,
}: {
  scope?: string;
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
  const { draft, set, focus } = useDraft(value, onCommit, DEBOUNCE_MS, scope);
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
        <input type="range" min={min} max={max} step={step} value={draft} aria-label={label} {...focus} onChange={(e) => set(Number(e.target.value))} />
        <div className="unit">
          <NumInput value={draft} min={min} max={max} step={step} label={`${label} value`} onValue={(n) => set(n)} {...focus} />
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
      scope={dev}
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
        <input type="color" aria-label={`${label} picker`} value={hex6(draft, fallback)} onChange={(e) => set(e.target.value)} />
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
    <NumInput value={draft[k] ?? 0} min={0} max={400} label={aria} onValue={(n) => set({ ...draft, [k]: n })} {...focus} />
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

/** Image address with an Upload button (POST /api/site/image: same role check and limits as the old editor). */
export function ImageField({ label, value, onCommit, validate = imageUrlError, placeholder = "https://… or /path" }: {
  label: string; value: string; onCommit: (v: string) => void; validate?: (v: string) => string | null; placeholder?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/site/image", { method: "POST", body: fd });
      const body = (await r.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
      if (r.ok && body?.url) onCommit(body.url);
      else setErr(body?.error?.message ?? "The upload failed. Try again.");
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="f">
      <TextField label={label} value={value} onCommit={onCommit} validate={validate} placeholder={placeholder} />
      <label className="btn upl" aria-disabled={busy}>
        <input
          type="file"
          className="sr"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          aria-label={`Upload ${label.toLowerCase()}`}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        {busy ? "Uploading…" : "Upload image…"}
      </label>
      <span aria-live="polite">
        <ErrText msg={err} />
      </span>
      <span id={id} className="sr">{busy ? "Uploading" : ""}</span>
    </div>
  );
}
