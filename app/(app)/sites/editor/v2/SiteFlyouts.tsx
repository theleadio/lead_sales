"use client";

// Typography, Background, SEO and Tracking flyouts. They edit SITE-wide
// settings (theme, seo, pixels, capi); the root saves them (debounced,
// version-checked) through saveSiteSettingsAction.
import { FONTS } from "@/lib/sites/fonts";
import { httpsOnlyError } from "@/lib/sites/editor-settings";
import { ImageField } from "./settings/controls";
import type { SiteSettingsView } from "./types";

type Change = (patch: Partial<SiteSettingsView>) => void;

const Swatch = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="sw">
    <span>{label}</span>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

export function TypeFlyout({ s, onChange }: { s: SiteSettingsView; onChange: Change }) {
  const t = s.theme;
  const font = (label: string, key: "headFont" | "bodyFont") => (
    <label className="f">
      <span>{label}</span>
      <select className="inp2" value={t[key]} onChange={(e) => onChange({ theme: { ...t, [key]: e.target.value } })}>
        {FONTS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="gb">
      {font("Headline font", "headFont")}
      {font("Content font", "bodyFont")}
      <Swatch label="Text colour" value={t.text} onChange={(v) => onChange({ theme: { ...t, text: v } })} />
      <Swatch label="Link colour" value={t.link} onChange={(v) => onChange({ theme: { ...t, link: v } })} />
      <p className="note">Every element set to “Headline font” or “Content font” follows these. Change once, the whole funnel updates.</p>
    </div>
  );
}

export function BgFlyout({ s, onChange }: { s: SiteSettingsView; onChange: Change }) {
  return (
    <div className="gb">
      <Swatch label="Page background" value={s.theme.bg} onChange={(v) => onChange({ theme: { ...s.theme, bg: v } })} />
      <p className="note">Applies to every step of this funnel. A section can have its own background colour or image in its settings.</p>
    </div>
  );
}

const fill = (t: string | undefined, v: Record<string, string>) => (t ?? "").replace(/\{\{([a-z][a-z0-9_]{1,40})\}\}/g, (m, k: string) => v[k] ?? m);

export function SeoFlyout({ s, values, domain, path, onChange }: { s: SiteSettingsView; values: Record<string, string>; domain: string; path: string; onChange: Change }) {
  const seo = s.seo;
  const set = (patch: Partial<SiteSettingsView["seo"]>) => onChange({ seo: { ...seo, ...patch } });
  return (
    <div className="gb" style={{ gap: 12 }}>
      <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
        {seo.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={seo.image} alt="" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ height: 110, background: "linear-gradient(135deg,#7c3aed,#111827)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>Share image</div>
        )}
        <div style={{ padding: 10, display: "grid", gap: 4 }}>
          <b>{fill(seo.title, values) || "Page title"}</b>
          <span className="note">{fill(seo.description, values) || "Description"}</span>
          <span className="note">
            {domain}
            {path === "/" ? "" : path}
          </span>
        </div>
      </div>
      <label className="f">
        <span>Page title</span>
        <input className="inp2" value={seo.title ?? ""} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="f">
        <span>Description</span>
        <textarea className="inp2" rows={3} value={seo.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <ImageField label="Share image address (https)" value={seo.image ?? ""} onCommit={(image) => set({ image })} validate={httpsOnlyError} placeholder="https://" />
      <label className="sw">
        <span>Hide from search engines</span>
        <input type="checkbox" checked={!!seo.noindex} onChange={(e) => set({ noindex: e.target.checked })} />
      </label>
      <p className="note">Preview of how the link looks on WhatsApp and Facebook. {"{{key}}"} custom values work in the title and description. These apply to every step of the funnel.</p>
    </div>
  );
}

export function TrackFlyout({ s, onChange }: { s: SiteSettingsView; onChange: Change }) {
  const px = s.pixels;
  const field = (label: string, key: keyof SiteSettingsView["pixels"]) => (
    <label className="f">
      <span>{label}</span>
      <input className="inp2" value={px[key] ?? ""} onChange={(e) => onChange({ pixels: { ...px, [key]: e.target.value } })} />
    </label>
  );
  return (
    <div className="gb" style={{ gap: 12 }}>
      {field("Meta pixel ID", "meta")}
      {field("Google tag ID", "google")}
      {field("TikTok pixel ID", "tiktok")}
      {field("LinkedIn partner ID", "linkedin")}
      <label className="sw">
        <span>Send server-side events to Meta</span>
        <input type="checkbox" checked={s.capi} onChange={(e) => onChange({ capi: e.target.checked })} />
      </label>
      <p className="note">No custom code box: pixels are added safely by ID. Cookie banner and consent follow PDPA.</p>
    </div>
  );
}
