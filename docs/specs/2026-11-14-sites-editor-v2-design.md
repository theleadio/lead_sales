# Sites & Funnels: editor v2 (SalesProcess-style builder)

Status: draft for Shawn's review, 14 Nov 2026. Replaces §6 `page_version.project` meaning, §7.1–7.4 (editor) and
the GrapesJS decision D4 of `2026-11-13-sites-funnels-design.md`. Everything else in that spec stands (publishing,
public serving on `ai.thelead.io`, forms, checkout, UTM, stats, Meta CAPI, security, PDPA, cutover).

## 1. Why

Shawn's browser check (13 Nov): the GrapesJS editor "is like lego and hard to use" and does not work like the
SalesProcess builder. A clickable prototype built to SalesProcess's model was approved on 14 Nov:
`docs/specs/assets/2026-11-14-editor-prototype.html` (also https://claude.ai/artifact/Aej4YakDjAQL7JxYWAtxod).
**The prototype is the UX reference: where this spec is silent, match the prototype.**

## 2. Decisions (Shawn, 13–14 Nov)

| # | Decision |
|---|---|
| E1 | Own editor on SalesProcess's model (option A). GrapesJS is removed. |
| E2 | Release 1 includes popups, the Animations tab and custom values (merge fields). Saved assets / global sections editing come later. |
| E3 | Marketing rebuilds the live pages by hand from the sections library and starter templates. No importer. |
| E4 | Drag and drop for adding (from the Add panel) and for moving (⠿ handle), plus click-to-add. |
| E5 | Dates: editor v2 usable ~4–5 Dec; 14 Dec switch-off unchanged. |

## 3. Page model

A page (`page_version.project`) is JSON, validated with zod on every save (`lib/sites/tree.ts`):

```
Page { version: 2, sections: Section[], popups: Popup[] }
Section { id, kind:'sec', name, width:'full'|'wide'|'medium'|'small', bg, bgImage?, pt:R, pb:R, hideOn:{d,t,m}, anim, rows: Row[] }
Row     { id, kind:'row', name, preset:'1'|'2'|'3'|'4'|'5'|'6'|'1/3+2/3'|'2/3+1/3', gap:R, mt, mb, valign, cols: Column[] }
Column  { id, kind:'col', name, pad:{t,r,b,l}, bg, radius, els: Element[] }
Element { id, kind:'el', type, name, anim, box:{mt,mb,pt,pr,pb,pl,bg,radius}, props }
Popup   { id, name, trigger:'exit'|'timer'|'button', delaySec?, sections: Section[] }
R (responsive number) = { d:number, t?:number|null, m?:number|null }  // tablet/phone fall back to the larger size
```

- **Fixed nesting:** sections hold rows, rows hold columns (count fixed by `preset`), columns hold elements. Nothing else.
- **Element types (release 1):** headline, sub, para, list, button, image, video, form (LEAD form), order (order form),
  faq, countdown, divider, icon-text (icon + text line), social (social icons), logos (logo showcase), counter
  (number counter), slider (image slider), nav (menu). Each has a zod `props` schema in `lib/sites/elements.ts`
  listing exactly the settings the panel shows (prototype shows the pattern).
- **Text:** `props.text` holds limited rich text: `b i u s a(href https/mailto/tel/#) br` and `{{key}}` custom-value
  tokens. Sanitised with sanitize-html on save and at publish.
- **Animations:** `anim` ∈ none | fade | up | left | zoom.
- Limits: ≤ 200 sections, depth fixed, JSON ≤ 1.5 MB.

## 4. Rendering (one renderer for editor and published page)

- `lib/sites/render/*.tsx`: React components for Section/Row/Column/Element/Popup that produce the page DOM, plus
  `pageCss(page, site)` that builds the CSS (one class per node id; desktop rules, then `@media (max-width:991px)`
  tablet and `@media (max-width:575px)` phone overrides from `R` values; fonts and colours from site typography).
- **Publish:** `renderToStaticMarkup` (react-dom/server) of the same components → html; `pageCss` → css; then the
  existing `cleanPage`, publish checks, version/route/audit/purge in `lib/sites/publish.ts`. LEAD form and order form
  render as the existing `<div data-lead="form|order" data-id data-settings>` placeholders (runtime contract unchanged).
- **Editor canvas:** the same components rendered into an `<iframe>` via a React portal (so media queries and page CSS
  apply at the chosen device width, isolated from editor CSS), with editor chrome drawn on top.
- **Custom values:** stored in `sales.custom_value(key text PK, label, value, updated_by, updated_at, version)`
  (migration 007). Published HTML keeps `{{key}}` tokens; `lib/sites/serve.ts` substitutes the current values
  (HTML-escaped) when serving, and in `<title>`/meta. Changing a value purges all live pages' cache tags.
  Unknown keys render as empty text.
- **Popups:** rendered hidden at the end of `<body>` as `<div data-lead="popup" data-id data-trigger data-delay>`;
  `public/site/runtime.js` opens them (exit intent on desktop = pointer leaves top; timer; button action
  `popup:<id>`), closes on × / Esc / backdrop, traps focus while open, once per visit per popup (sessionStorage).
- **Animations at runtime:** runtime adds `class="lead-anim"` to `<html>`; elements with `data-anim` start hidden only
  when that class is present and are revealed by IntersectionObserver; `prefers-reduced-motion` → no animation.
  Without JS the page is fully visible.
- **Button actions:** `form` (scroll to the page's LEAD/order form), `next` (the funnel's next step path), `popup:<id>`,
  `url` (https only). Rendered as real `<a href>` with `data-action` so they work without JS where possible.

## 5. Editor UI (match the prototype)

- **Top bar:** Back, save status ("Saving… / Saved just now / Changed by someone else"), step switcher, device
  (Desktop 1200 / Tablet 768 / Phone 390), Undo/Redo (Ctrl+Z / Ctrl+Y, 100 steps), Preview, Publish.
- **URL bar:** live address + Live/Draft pill.
- **Left rail + flyouts:** Add (Quick add · Sections by width · Rows by layout · Elements · Prebuilt sections with
  live thumbnails by category), Layers (tree, click selects), Pages (funnel steps; switch; add step), Typography
  (headline font, content font, text colour, link colour — site-wide), Background, Popups (list, trigger, Edit opens
  the popup in the canvas, Create), Custom values (edit inline), SEO (share preview card + fields), Tracking (pixel ids,
  CAPI toggle — existing site settings).
- **Canvas:** hover outline + label, select outline; colours section green / row blue / column purple / element orange;
  selected item toolbar: ⠿ drag, ↑, ↓, ⚙ (left) and duplicate, delete (right); "+" on the bottom edge opens the
  context insert menu (section → widths or library; row → layouts; column/element → element list); empty column shows
  an "add element" hint; hidden-on-device sections show a striped placeholder.
- **Right panel:** title with kind colour; tabs General / Styles / Animations; grouped, collapsible sections; controls:
  slider + number with unit, device tag on responsive values (edits the current device's value), chips, selects,
  colour swatches, the visual margin/padding box, textareas for list items, per-element settings as in the prototype.
  Empty state explains the colours and double-click editing.
- **Inline text:** double-click text → editable in place with a floating toolbar (font role, B, I, U, S, link, insert
  custom value, Done); Esc or click outside ends editing and saves.
- **Drag and drop:** pointer events (mouse/pen/touch), 5 px threshold so clicks still work; drop line coloured by
  kind with a label; sections drop between sections, rows into a section, elements into a column; auto-scroll near
  edges; Ctrl+Z undoes a drop.
- **Breadcrumb:** Page › Section › Row › Column › Element, clickable.
- **Autosave:** every 3 s after a change; version-checked (`saveDraft`), edit lock and take-over as today.
- **Keyboard:** Delete removes the selected item (not while typing), Esc deselects, arrow keys do nothing special.
- **Accessibility:** all controls labelled; toolbar buttons have titles and aria-labels; focus visible.

## 6. Library and templates

- **Prebuilt sections** (`lib/sites/library.ts`, trees): Hero ×2, Call to action, For who, Course details, Trainer,
  Testimonials (asks for a real quote), Pricing, FAQs, Sign-up form, Countdown, Footer (with privacy link). All copy
  visibly `[placeholder]`; no invented testimonials, numbers or prices.
- **Starter funnels** (seed): Workshop sign-up (form type workshop), Paid course (Home + Payment Form with order
  form + Thank You), Lead magnet — rebuilt as v2 trees.

## 7. What changes in existing code

- Removed: `grapesjs` dependency, `app/(app)/sites/editor/components/*`, `panels.ts`, GrapesJS editor.
- `saveDraft(viewer, pageId, { project }, version)` — html/css are no longer stored on drafts; publish renders them.
- `publish.ts` renders from the tree; global-section inlining stays for legacy data only (no v2 UI yet).
- Preview route renders the draft tree.
- Old v1 drafts/templates (test data only) are deleted by the seed / a one-off script; no migration.

## 8. Testing

- Unit: tree schema (valid/invalid nesting, limits), element props schemas, `pageCss` responsive output, rich-text
  sanitiser, renderer snapshot per element type, custom-value substitution (escaping, unknown keys).
- DB: save/publish round trip of a v2 tree, custom values change + purge, popup markup in published HTML.
- Runtime: popup triggers/close/once-per-visit, animation reveal, button actions (runtime-core pure tests).
- Editor logic (pure reducers in `lib/sites/editor-state.ts`: insert/move/delete/duplicate/drag-drop targets/undo)
  unit-tested.
- Browser check with Shawn signed in: build a page from the library by drag and drop, edit text, change a custom
  value, add a popup, publish, view on phone width.

## 9. Open items

1. Fonts list beyond Inter / Poppins / Montserrat / Noto Sans SC / Noto Serif SC.
2. Saved assets & global sections editing (release 2).
