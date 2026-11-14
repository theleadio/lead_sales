# Sites editor v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GrapesJS editor with a SalesProcess-style builder (Section → Row → Column → Element, colour-coded selection, plain settings panel, drag and drop, sections library, popups, animations, custom values) that publishes through the existing pipeline.

**Architecture:** The page is a validated JSON tree. One set of React components renders it both in the editor (inside an iframe via portal) and at publish (`renderToStaticMarkup`), with a CSS generator for responsive values. Editor logic lives in pure, tested reducers; the UI is React client components that follow the approved prototype. Publishing, public serving, forms, checkout, stats and CAPI are reused unchanged.

**Tech Stack:** Next.js 16.3.6 (read `node_modules/next/dist/docs/` before writing routes/pages), React 19.2.8, react-dom/server, zod 4, sanitize-html 2.17.7, postgres.js, node:test. No new dependencies; `grapesjs` is removed.

**Spec:** `docs/specs/2026-11-14-sites-editor-v2-design.md` (and, for everything not changed, `docs/specs/2026-11-13-sites-funnels-design.md`). **UX reference:** `docs/specs/assets/2026-11-14-editor-prototype.html` — read it; match its layout, wording, colours and interactions.

## Global Constraints

- Branch `claude/sites-funnels-phase1`, worktree `lead_crm-worktrees/sales-sites`; local test DB only (`.env.local`); LF line endings; commit messages end with the repo's Co-Authored-By line.
- Nesting is fixed: Page.sections → Section.rows → Row.cols (count from `preset`) → Column.els. Reducers and schema must make any other shape impossible.
- Kind colours: section `#16a34a`, row `#2563eb`, column `#9333ea`, element `#ea580c`.
- Device widths: desktop 1200, tablet 768, phone 390. Breakpoints in published CSS: tablet `max-width:991px`, phone `max-width:575px`.
- Responsive number `R = { d, t?, m? }`; tablet falls back to desktop, phone to tablet then desktop.
- Rich text allows only `b i u s a br` (+ `{{key}}` tokens); `a href` only https, mailto, tel, `#…`.
- LEAD form and order form publish as the existing placeholders `<div data-lead="form|order" data-id data-settings>`; `data-settings` must parse with `leadFormSettingsSchema` / `orderFormSettingsSchema`.
- Copy in library/templates: visibly `[placeholder]`; no invented testimonials, numbers or prices.
- Roles: edit/publish super_admin, management, marketing; view/preview sales, operations.
- No personal data in URLs or logs.

## Review Focus

1. **A paste of rich text from Word/Google Docs into inline editing** → only allowed tags survive (no styles/classes/scripts), page still saves. Test in Task 1 (sanitiser) and Task 6 (paste handler).
2. **Dragging a section onto itself, or a row into the row it came from** → no-op, no lost node, undo restores. Test in Task 4.
3. **Changing a custom value used in a live page's `<title>`** → live page shows the new value after purge, HTML-escaped (`<script>` in a value renders as text). Test in Task 2.
4. **Phone-width override set, then desktop value changed** → phone keeps its override; tablet without override follows desktop. Test in Task 2 (pageCss).
5. **A popup with trigger "exit" on a touch device** → never traps the visitor (no exit intent on touch; only timer/button). Test in Task 3.

---

### Task 1: Tree model, element schemas, custom values table

**Files:** Create `lib/sites/tree.ts`, `lib/sites/elements.ts`, `lib/sites/richtext.ts`, `db/migrations/007_custom_values.sql`; modify `lib/sites/admin.ts` (saveDraft), tests `tests/sites-tree.test.ts`, `tests/sites-admin-db.test.ts`.

**Interfaces (produces):**
- `pageSchema`, `type Page`, `Section`, `Row`, `Column`, `Element`, `Popup`, `R` (spec §3); `ELEMENT_TYPES` and `elementPropsSchema(type)`; `defaultProps(type)`; `newId(prefix: 's'|'r'|'c'|'e'|'p'): string` (crypto.randomUUID based).
- `presetColumns(preset): number`.
- `sanitizeRich(html: string): string` (sanitize-html allowlist from Global Constraints; strips everything else; keeps `{{key}}`).
- `saveDraft(viewer, pageId, { project: Page }, version)` — parses with `pageSchema` (refuse `{kind:'invalid', message}`), sanitises every rich text, stores only `project`.
- Migration 007: `sales.custom_value(key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'), label text not null, value text not null default '', updated_by uuid references app_user(id), updated_at timestamptz default now(), version int default 1)`.

- [ ] Tests first: valid tree passes; element inside a section/row refused; row with 3 cols but preset "2" refused; unknown element type refused; 1.5 MB limit; `sanitizeRich` strips `style`, `class`, `<script>`, `javascript:` hrefs, keeps `b/i/u/s/a/br` and `{{course_name}}` (Review Focus 1); saveDraft invalid → `invalid`, valid → stored.
- [ ] Run, expect fail → implement → pass → full suite → commit.

### Task 2: Renderer, CSS generator, publish/preview/serve integration, custom values service

**Files:** Create `lib/sites/render/*.tsx` (Page, Section, Row, Column, one component per element type), `lib/sites/render/css.ts`, `lib/sites/custom-values.ts`; modify `lib/sites/publish.ts`, `lib/sites/serve.ts`, `app/(app)/sites/preview/[pageId]/route.ts`; tests `tests/sites-render.test.tsx` (or .ts with React.createElement), `tests/sites-custom-values-db.test.ts`, `tests/sites-publish-db.test.ts`.

**Interfaces:**
- `renderPageHtml(page: Page, ctx: { site: SiteRow; steps: { id: string; path: string }[]; pageId: string; forEditor?: false }): string` (renderToStaticMarkup); `PageView` React component (used by the editor in Task 5 with `forEditor: true`, which adds `data-node-id` attributes for selection).
- `pageCss(page: Page, site: SiteRow): string`.
- `listCustomValues(viewer)`, `saveCustomValue(viewer, {key,label,value}, version|null)` (audited; purges all live page tags via `lib/sites/purge.ts`), `applyValues(html: string, values: Map<string,string>): string` (escapes values; unknown → '').
- publishPage renders html/css from the draft tree, then the existing cleanPage/checks/route/audit/purge. serve.ts applies values to body, title and meta.

- [ ] Tests first: each element type renders expected markup (snapshot strings); form/order placeholders parse with their schemas; `pageCss` desktop + tablet/phone media rules, phone override kept when desktop changes, tablet falls back (Review Focus 4); custom value with `<script>` renders escaped in body and `<title>`, change purges (Review Focus 3); publish round trip of a v2 tree; preview renders draft tree.
- [ ] Implement → pass → full suite + `npm run build` → commit.

### Task 3: Runtime — popups, animations, button actions

**Files:** Modify `lib/sites/runtime-core.ts`, `lib/sites/runtime-dom.ts`, `public/site/runtime.css`, regenerate `public/site/runtime.js` (`npm run build:runtime`); tests `tests/sites-runtime.test.ts`.

**Interfaces:** pure `popupShouldOpen(trigger, state: {touch:boolean, elapsedSec:number, exitIntent:boolean, seen:boolean, delaySec:number}): boolean`; `buttonTarget(action, ctx): {kind:'scroll'|'nav'|'popup'|'none', value?}`; DOM: popup open/close (×, Esc, backdrop), focus trap, once per visit (sessionStorage, try/catch), IntersectionObserver reveal with `html.lead-anim`, reduced-motion skip.

- [ ] Tests first: exit trigger never fires on touch (Review Focus 5); timer fires after delay; seen → no reopen; button actions map; reduced motion → no anim class.
- [ ] Implement → regenerate runtime.js → pass → commit.

### Task 4: Editor state reducers (pure)

**Files:** Create `lib/sites/editor-state.ts`; tests `tests/sites-editor-state.test.ts`.

**Interfaces:** `type EditorState = { page: Page; sel: string | null; past: Page[]; future: Page[] }`; actions `select`, `insert(kind, node, at: DropTarget)`, `move(id, at: DropTarget)`, `remove(id)`, `duplicate(id)`, `moveUp/moveDown(id)`, `update(id, patch)`, `setRowPreset(id, preset)` (merges removed columns' elements into the last remaining column), `undo`, `redo` (100 steps); `DropTarget = { parentId: string | 'page' | 'popup:<id>'; index: number }`; `validTarget(kind, target): boolean`; `findPath(page, id)`.

- [ ] Tests first: every action keeps `pageSchema` valid; move of a section onto itself / row into its own position is a no-op (Review Focus 2); undo/redo restore exactly; duplicate gives fresh ids; preset shrink keeps elements.
- [ ] Implement → pass → commit.

### Task 5: Editor shell (canvas, chrome, flyouts) — remove GrapesJS

**Files:** Replace `app/(app)/sites/editor/**` (keep `[pageId]/page.tsx` server part: permission, getDraft, lock); create `app/(app)/sites/editor/v2/*.tsx` (TopBar, Rail, Flyouts, Canvas (iframe + portal rendering `PageView`), SelectionChrome, InsertMenu, Breadcrumb); remove `grapesjs` from package.json; server actions for save/publish/values/site settings reuse existing services.

**Interfaces:** consumes Task 2 `PageView`, Task 4 reducers; `saveDraftAction(pageId, project, version)`; autosave 3 s; lock/take-over banner as today.

- [ ] Build to the prototype: top bar, URL bar, rail + flyouts (Add with Quick add/Sections/Rows/Elements/Prebuilt — prebuilt uses Task 7 library, stub list until then), Layers, Pages, Typography, Background, Popups, Custom values, SEO, Tracking; canvas hover/select outlines + labels, toolbars, "+" insert menus, empty-column hint, device widths, breadcrumb, undo/redo keys, Delete/Esc keys.
- [ ] `npm run build`, full suite → commit. (Browser check is the controller's, after Task 7.)

### Task 6: Settings panel, inline text editing, drag and drop

**Files:** `app/(app)/sites/editor/v2/SettingsPanel.tsx`, `InlineText.tsx`, `DragDrop.ts`; tests for any pure helpers (drop-target maths in `lib/sites/editor-state.ts` if added).

- [ ] Settings: General/Styles/Animations per kind and element type exactly as the prototype (sliders + unit, device tag, chips, selects, swatches, spacing box, list textarea, FAQ editor, form/order settings with workshop name preview, button actions incl. open popup, section width/hide-on, row preset/gap/valign, animation preview).
- [ ] Inline text: double-click → contenteditable with toolbar (font role, B/I/U/S, link, custom value menu, Done); paste handler inserts sanitised content only (Review Focus 1); Esc/blur saves via `update`.
- [ ] Drag and drop: pointer events, 5 px threshold, coloured drop line with label, auto-scroll, targets per kind via `validTarget`, ⠿ handle moves, works in the iframe canvas (translate coordinates).
- [ ] `npm run build`, full suite → commit.

### Task 7: Sections library, starter templates, cleanup

**Files:** `lib/sites/library.ts` (12 sections from spec §6 as v2 trees + thumbnails rendered with `PageView` at 24% scale), `scripts/seed-site-templates.ts` (3 v2 starters; delete v1 templates and v1 drafts on local seed run only), admin screens: Edit link unchanged; template payload stays `{steps:[{name,kind,suffix,project}]}` with v2 projects.

- [ ] Tests: every library section and template validates with `pageSchema`; no unmarked copy (each text node contains `[placeholder]` or is a structural label from an allowlist); seed idempotent.
- [ ] Implement → pass → build → commit.

### Task 8 (controller): browser check with Shawn + final review

- [ ] Local dev, Shawn signed in: create from template, drag sections/elements, edit text, change custom value, add popup, animations, publish, view on phone; fix findings; final whole-branch review (sonnet); then Task 15 of the phase-1 plan.
