"use client";

// Custom values: {{key}} text used across pages, popups and SEO. Edit inline;
// the root saves each change (debounced) through saveValueAction.
import { useState } from "react";
import type { ValueRow } from "./types";

type Props = {
  values: ValueRow[];
  onEdit: (key: string, value: string) => void;
  onCreate: (v: { key: string; label: string; value: string }) => Promise<string | null>;
};

export default function ValuesFlyout({ values, onEdit, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ key: "", label: "", value: "" });
  const [err, setErr] = useState("");
  return (
    <div className="list">
      {values.map((v) => (
        <div key={v.key} className="li" style={{ display: "grid", gap: 6 }}>
          <span>
            <code>{`{{${v.key}}}`}</code> · {v.label}
          </span>
          <input className="inp2" aria-label={`${v.label} value`} value={v.value} maxLength={2000} onChange={(e) => onEdit(v.key, e.target.value)} />
        </div>
      ))}
      {!values.length && <p className="note">No custom values yet.</p>}
      {open ? (
        <form
          className="f"
          style={{ gap: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const m = await onCreate(f);
            if (m) setErr(m);
            else {
              setErr("");
              setOpen(false);
              setF({ key: "", label: "", value: "" });
            }
          }}
        >
          <label className="f">
            <span>Key (lowercase, digits, _)</span>
            <input className="inp2" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} pattern="[a-z][a-z0-9_]{1,40}" required />
          </label>
          <label className="f">
            <span>Label</span>
            <input className="inp2" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required />
          </label>
          <label className="f">
            <span>Value</span>
            <input className="inp2" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          </label>
          {err && (
            <p className="note" role="alert" style={{ color: "#b42318" }}>
              {err}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" type="submit">
              Add value
            </button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn" type="button" onClick={() => setOpen(true)}>
          ＋ New value
        </button>
      )}
      <p className="note">Edit a value here and every page, popup and SEO title that uses it changes, live pages included.</p>
    </div>
  );
}
