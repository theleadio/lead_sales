# Sites & Funnels — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marketing can build multi-step funnels (landing → payment → thank you) in a drag-and-drop editor inside `lead_sales`, publish them on `ai.thelead.io/<path>`, capture leads and class payments through the CRM with full UTM attribution, and see per-step stats — live by **Fri 27 Nov 2026**.

**Architecture:** GrapesJS editor in the signed-in `lead_sales` app saves page projects to new `sales.*` tables; publish cleans the HTML and stores a version; `proxy.ts` routes the `ai.thelead.io` host to a public page route that serves the published HTML from the CDN. Forms and checkout call lead_crm's existing public API server-to-server (`/api/public/leads`, `/api/public/register`) with `PUBLIC_API_KEY`; nothing in `lead_sales` writes CRM tables for this feature. Meta CAPI events go through a `sales` queue drained by the 5-minute schedule.

**Tech Stack:** Next.js 16.3.6 (read `node_modules/next/dist/docs/` before writing routes — breaking changes), React 19, postgres.js, zod 4, GrapesJS (new, pinned exact), Supabase Storage, node:test.

**Spec:** `docs/specs/2026-11-13-sites-funnels-design.md` (phase 1 = §4 row 1; phases 2–4 get their own plans).

## Global Constraints

- Public host: `ai.thelead.io`. App host: `theleadsales.netlify.app` (and any non-`ai.thelead.io` host).
- Migrations only touch the `sales` schema (`scripts/migrate.ts` refuses otherwise). New file: `db/migrations/006_sites.sql`.
- Roles that may create/edit/publish: `super_admin`, `management`, `marketing`. View/preview only: `sales`, `operations`. Everyone else: no access.
- Optimistic concurrency: every editable row has `version int`; a save with a stale version is refused (`kind: "conflict"`), never overwritten.
- Every publish, unpublish, restore and settings change is audited via `writeAudit` (`entity: "site"` or `"site_page"`).
- No personal data (name, email, phone, IP) in URLs, logs, error messages or `sales.page_view_day`.
- Marketing-consent tickbox: always rendered, unticked by default; cannot be removed in the editor.
- Workshop form name format, exactly: `LEAD - <title> <d> <Mon> <YYYY>` (e.g. `LEAD - AI Vibe Coding Masterclass 18 Nov 2026`); must parse with lead_crm `parseWorkshopForm`.
- Times are Asia/Kuala_Lumpur days for stats.
- New npm dependencies: `grapesjs` and `sanitize-html` only (exact versions, each ≥ 2 weeks old). Everything else uses what is installed.
- Images: jpg, png, webp, svg (sanitised); max 5 MB; Supabase Storage public bucket `PAGE_IMAGE_BUCKET`, random file names.
- Copy: no fabricated testimonials or stats in templates; placeholder text is visibly marked `[placeholder]`.
- Commit style: one commit per task, message ends with the repo's Co-Authored-By line.

## Review Focus

1. **A visitor arrives on an `ai.thelead.io` path that has no published page** (old GHL link, typo) → expect the site's redirect if one exists, else the holding page with HTTP 404 status and a link to upcoming classes — never the app's sign-in page. Test in Task 7.
2. **Marketing pastes HTML containing `<script>` or `onerror=` via the rich-text element** → stripped at publish, page still publishes, and a warning lists what was removed. Test in Task 5.
3. **Two marketers edit the same step in two tabs** → the second save is refused with "changed by someone else — reload", no work silently lost. Test in Task 4.
4. **Order form submitted for a class that is full or closed by the time they pay** → inline "This class is full" from the CRM's answer, no Stripe redirect. Test in Task 11.
5. **Visitor submits the LEAD form twice (double click / retry)** → one lead (same idempotency key reaches the CRM), thank-you shown both times. Test in Task 10.

---

## File Structure

| Path                                                     | Responsibility                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `db/migrations/006_sites.sql`                            | All phase-1 tables                                                                   |
| `lib/sites/model.ts`                                     | zod schemas and types: site settings, page kinds, paths, form/order element settings |
| `lib/sites/permissions.ts`                               | `canEditSites`, `canViewSites`                                                       |
| `lib/sites/admin.ts`                                     | Folders, sites, pages, drafts, templates, global sections (DB access + audit)        |
| `lib/sites/clean.ts`                                     | HTML cleaner                                                                         |
| `lib/sites/publish.ts`                                   | Publish checks, publish, unpublish, restore, history                                 |
| `lib/sites/serve.ts`                                     | Resolve host+path → published page, redirect, or holding page                        |
| `lib/sites/workshop-name.ts`                             | Workshop form-name builder                                                           |
| `lib/sites/crm-api.ts`                                   | Server-to-server client for lead_crm `/api/public/leads` and `/register`             |
| `lib/sites/forms.ts`                                     | LEAD form submission handler                                                         |
| `lib/sites/checkout.ts`                                  | Order form submission handler                                                        |
| `lib/crm/attribution.ts`                                 | Copy of lead_crm `app/(public)/attribution.ts` rules (first/last touch)              |
| `lib/sites/stats.ts`                                     | View beacon recording + stats query                                                  |
| `lib/sites/capi.ts`                                      | Meta CAPI queue, event builders, sender                                              |
| `proxy.ts`                                               | Host routing                                                                         |
| `app/(app)/sites/**`                                     | Lists, funnel screens, settings, editor page                                         |
| `app/(app)/sites/editor/**`                              | GrapesJS client component + LEAD components                                          |
| `app/(site)/[[...path]]/route.ts`                        | Public page serving on `ai.thelead.io`                                               |
| `app/api/site/{form,checkout,view,image}/route.ts`       | Public and editor endpoints                                                          |
| `public/site/runtime.js`                                 | Tiny public script: cookies, beacon, form/checkout submit, FAQ, slider, counter      |
| `scripts/capi-run.ts` + `.github/workflows/schedule.yml` | CAPI drain job                                                                       |

Reuse from draft PR #29 (`claude/page-builder`): `lib/pages/images.ts` (upload) and `app/api/pages/image/route.ts` → move to `lib/sites/images.ts`, `app/api/site/image/route.ts`. Discard the rest of #29 except as fallback.

---

### Task 1: lead_crm public API changes (repo `theleadio/lead_crm`)

**Files:**

- Modify: `lib/validation/public.ts` (lead + register schemas), `lib/public/leads.ts` (touchpoint insert, deal step), `lib/public/register.ts` (`returnUrls`), `lib/public/handlers.ts` (client IP)
- Test: `tests/public-api-db.test.ts`, `tests/public-register-db.test.ts` (existing files; add cases)

**Interfaces:**

- Produces (HTTP, used by Task 8):
  - `POST /api/public/leads` body adds `attribution.utmId`, `attribution.utmAdId` (≤200 chars), `createDeal?: boolean` (default `true`), `attribution.firstTouch` (existing).
  - `POST /api/public/register` body adds `returnUrl?: string`; accepted only if it starts with `https://ai.thelead.io/`; becomes `success_url` (with `?session_id={CHECKOUT_SESSION_ID}` appended) and `cancel_url` (without).
  - Both: header `X-Lead-Client-Ip` is used as the client IP for rate limits **only when the API key checks `ok`**; otherwise ignored.

- [ ] **Step 1: Write failing tests**
  - `lead with utmId/utmAdId stores them on the touchpoint` → `touchpoint.utm_campaign_id = '6878812432797'`, `utm_ad_id = '120210000000001'`.
  - `lead with createDeal false creates person and touchpoint but no deal; LeadCaptured payload dealId is null`.
  - `register with returnUrl on ai.thelead.io uses it for Stripe success and cancel` (fake checkout port captures `successUrl === 'https://ai.thelead.io/x/thanks?session_id={CHECKOUT_SESSION_ID}'`).
  - `register with returnUrl elsewhere falls back to the CRM thank-you URL`.
  - `X-Lead-Client-Ip is ignored without a valid API key` (two calls from one header IP under a bad key → limited by the real IP bucket).
- [ ] **Step 2: Run, expect FAIL** — `npm test -- tests/public-api-db.test.ts tests/public-register-db.test.ts`
- [ ] **Step 3: Implement** in the files above. `LeadCaptured` payload type gets `dealId: string | null`; check lead_sales automations' `LeadCaptured` consumers tolerate null (they read `personId`).
- [ ] **Step 4: Run the full suite** — `npm test` → all pass.
- [ ] **Step 5: Commit, open PR in lead_crm** — "Public API: returnUrl, campaign/ad ids, optional deal, client IP for lead_sales pages". Merge before Task 8 integration tests run against staging/prod.

---

### Task 2: Migration 006 — sites schema

**Files:**

- Create: `db/migrations/006_sites.sql`
- Test: `tests/sites-schema-db.test.ts`

**Interfaces:**

- Produces tables (all `sales.`): `site_folder(id uuid pk, name text, kind text check in ('funnel','website'), created_at)`; `site(id, kind, name, folder_id fk null, domain text default 'ai.thelead.io', base_path text, language text check in ('en','zh'), settings jsonb default '{}', created_by/updated_by uuid fk app_user, created_at, updated_at, version int default 1)`; `site_page(id, site_id fk cascade, position int, name, path text, kind text check in ('page','checkout','thank_you'), active_version_id uuid null, created_at, updated_at, version int)` plus `edit_lock_user_id uuid null, edit_lock_at timestamptz null`, with unique `(site_id, position)`; `page_version(id, page_id fk cascade, variant text default 'A', project jsonb, html text, css text, status text check in ('draft','published','archived'), published_by uuid null, published_at timestamptz null, created_at)` with a partial unique index: one `draft` per (page_id, variant); `site_route(domain text, path text, page_id uuid fk null, redirect_to text null, primary key (domain, path))` — the live routing table, written only by publish/unpublish/redirect; `global_section(id, name, project jsonb, html, css, version, updated_at)`; `site_template(id, kind text check in ('funnel','website','section'), name, payload jsonb, created_at)`; `page_view_day(page_id, variant, day date, views int, uniques int, primary key (page_id, variant, day))`; `page_view_seen(page_id, day, visitor_hash text, primary key (page_id, day, visitor_hash))` (deleted after 2 days); `capi_event(id uuid, event_id text unique, name text, payload jsonb, status text check in ('queued','sent','failed'), attempts int default 0, next_attempt_at timestamptz, last_error text, created_at)`.
- Path check on `site_route.path`: `^/([a-z0-9]+(-[a-z0-9]+)*)(/[a-z0-9]+(-[a-z0-9]+)*){0,4}$` or exactly `/`.

- [ ] **Step 1: Write failing tests** — `006 creates the sites tables`; `a second draft for the same page and variant is refused`; `a route path with capitals or spaces is refused`; `deleting a site removes its pages and versions`.
- [ ] **Step 2: Run, expect FAIL** — `node --env-file=.env.local --test tests/sites-schema-db.test.ts`
- [ ] **Step 3: Write `006_sites.sql`**; apply locally: `npm run db:migrate -- --apply` (local `.env.local` only).
- [ ] **Step 4: Run tests + `tests/migrations.test.ts` → PASS**
- [ ] **Step 5: Commit**

---

### Task 3: Model and permissions

**Files:**

- Create: `lib/sites/model.ts`, `lib/sites/permissions.ts`, `lib/sites/workshop-name.ts`
- Test: `tests/sites-model.test.ts`

**Interfaces:**

- Produces:
  - `siteSettingsSchema` (zod) → `SiteSettings = { favicon?: string; pixels: { meta?: string; google?: string; linkedin?: string; tiktok?: string }; capi: boolean; chatWidget?: { whatsapp: string }; paymentMode: 'live' | 'test'; seo: { title?: string; description?: string; image?: string; noindex?: boolean }; privacyUrl?: string }`
  - `pathSchema` (same rule as Task 2's check), `normalizePath(input: string): string` (trim, lower-case, collapse slashes, strip trailing slash)
  - `leadFormSettingsSchema` → `LeadFormSettings = { type: 'workshop' | 'interest' | 'enquiry'; workshop?: { title: string; date: string /*YYYY-MM-DD*/; language: 'en' | 'zh' }; formName?: string; courseCode?: string; classCode?: string; fields: ('company' | 'jobTitle' | 'message')[]; createDeal: boolean; after: { kind: 'message'; text: string } | { kind: 'step'; pageId: string } | { kind: 'url'; url: string } }`
  - `orderFormSettingsSchema` → `OrderFormSettings = { classCode: string; askCompany: boolean }`
  - `formNameFor(s: LeadFormSettings, pageSlug: string): string`
  - `workshopFormName(title: string, date: string): string` → `LEAD - <title> <d> <Mon> <YYYY>`
  - `canEditSites(role: Role): boolean`, `canViewSites(role: Role): boolean`

- [ ] **Step 1: Write failing tests**
  - `workshopFormName('AI Vibe Coding Masterclass', '2026-11-18') === 'LEAD - AI Vibe Coding Masterclass 18 Nov 2026'`
  - round trip: copy lead_crm's `parseWorkshopForm` regex into the test as a fixture: `/\bLEAD\s*-\s*(.+?)\s*(?:-\s*)?(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})\s*$/i` matches the output for EN and a Chinese title.
  - `normalizePath(' /CN//Workshop/claude-ai-masterclass/ ') === '/cn/workshop/claude-ai-masterclass'`; `pathSchema` refuses `/a b`, `/../x`.
  - `canEditSites`: true for super_admin, management, marketing; false for sales, operations, support, part_time. `canViewSites` adds sales, operations.
  - `formNameFor` interest with empty formName → `page:<slug>`.
- [ ] **Step 2: Run, expect FAIL** — `node --test tests/sites-model.test.ts`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 4: Admin data access

**Files:**

- Create: `lib/sites/admin.ts`
- Test: `tests/sites-admin-db.test.ts`

**Interfaces:**

- Consumes: Task 2 tables, Task 3 schemas/permissions, `writeAudit`, `withTransaction`.
- Produces (all take `viewer: { id: string; role: Role }` first and throw `SitesPermissionError` when not allowed):
  - `listSites(viewer, kind: 'funnel' | 'website'): Promise<SiteRow[]>` — with folder, step count, live URL of step 1, `updatedAt`.
  - `createFunnel(viewer, input: { name: string; folderId?: string; language: 'en'|'zh'; basePath: string; templateId?: string }): Promise<{ siteId: string }>` — creates 3 steps (`page` "Home" at basePath, `checkout` "Payment Form" at `<basePath>/payment`, `thank_you` "Thank You" at `<basePath>/thank-you`) each with an empty draft, or copies the template.
  - `getSite(viewer, siteId)`, `updateSiteSettings(viewer, siteId, settings: SiteSettings, version: number): Promise<{ kind: 'ok'; version: number } | { kind: 'conflict' }>`
  - `addStep / moveStep / renameStep / deleteStep / cloneStep` (each version-checked on the site)
  - `getDraft(viewer, pageId): Promise<{ project: unknown; version: number; lockedBy: string | null }>`
  - `saveDraft(viewer, pageId, project: unknown, version: number): Promise<{ kind: 'ok'; version: number } | { kind: 'conflict' }>` — `version` lives on `site_page`; a draft save bumps it.
  - `takeEditLock(viewer, pageId): Promise<{ holder: { id: string; name: string } | null }>` — soft lock in `site_page.edit_lock_user_id / edit_lock_at` (Task 2); stale after 2 minutes without a save; `holder` is someone else still holding it.
  - Folders, templates (`saveTemplate`, `listTemplates`), global sections (`listGlobalSections`, `saveGlobalSection` version-checked).

- [ ] **Step 1: Write failing tests** — `marketing creates a funnel with Home, Payment Form and Thank You steps`; `sales cannot create a funnel and the refusal is audited`; **`a stale draft save is refused as conflict`** (Review Focus 3); `a second editor sees the first editor as lock holder until 2 minutes pass`; `settings change is audited with before/after`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 5: HTML cleaner

**Files:**

- Create: `lib/sites/clean.ts`
- Modify: `package.json` (`sanitize-html` exact version)
- Test: `tests/sites-clean.test.ts`

**Interfaces:**

- Produces: `cleanPage(html: string, css: string): { html: string; css: string; removed: string[] }` — `removed` is human-readable ("script tag", "onerror attribute on img", …).
- Allowed iframes: `https://www.youtube.com/embed/`, `https://www.youtube-nocookie.com/embed/`, `https://player.vimeo.com/video/`, `https://www.google.com/maps/embed`. Our own components are marked `data-lead="form" | "order" | …` and kept.
- Built on `sanitize-html` with an explicit allow-list (tags, attributes, URL schemes `https`, `mailto`, `tel`, iframe hostnames above); CSS cleaned by a separate pass that drops `@import`, `expression(`, `url(javascript:`/`url(data:text`. The attack-list test is the gate.

- [ ] **Step 1: Write failing tests** — table-driven list of ≥ 25 attack strings (`<script>`, `<img src=x onerror=alert(1)>`, `<a href="javascript:…">`, `<a href=" JaVaScRiPt:…">`, `<svg><script>`, `<iframe src="https://evil">`, `<object>`, `<embed>`, `<base href>`, `<meta http-equiv="refresh">`, `<form action="https://evil">`, `style="background:url(javascript:…)"`, CSS `@import url(evil)`, `expression(`, data-URL HTML) → none survive; a normal GrapesJS page (fixture from Task 14's template) passes byte-for-byte except stripped bits; **`removed` lists each stripped item`** (Review Focus 2).
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 6: Publish, unpublish, restore, history

**Files:**

- Create: `lib/sites/publish.ts`
- Test: `tests/sites-publish-db.test.ts`

**Interfaces:**

- Consumes: Tasks 2–5.
- Produces:
  - `publishCheck(page, draft, site): string[]` — reasons: missing privacy link (site setting or footer), LEAD form unconfigured, order form without class, workshop date in the past (KL), path taken on the domain, image over limit.
  - `publishPage(viewer, pageId, version): Promise<{ kind: 'ok'; removed: string[] } | { kind: 'refused'; reasons: string[] } | { kind: 'conflict' }>` — renders global sections into the HTML, cleans (Task 5), archives the previous `published` version, inserts the new one, upserts `site_route(domain, path, page_id)`, audits, purges CDN cache tag `page:<pageId>` (Netlify purge API, token `NETLIFY_PURGE_TOKEN`; purge failure logged, not fatal).
  - `publishSite(viewer, siteId)` — all steps, all-or-nothing.
  - `unpublishPage(viewer, pageId)` — sets `site_route.page_id = null` (holding page), audits.
  - `listVersions(viewer, pageId)`, `restoreVersion(viewer, pageId, versionId)` — copies it into the draft and publishes.
  - `setRedirect(viewer, domain, path, to: string)` — for old GHL paths (cutover).

- [ ] **Step 1: Write failing tests** — `publish refuses without privacy link`; `publish refuses a past workshop date`; `publish moves the route and archives the previous version`; `restore brings back an archived version as live`; `publishing a path another site owns is refused`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 7: Host routing and public serving

**Files:**

- Modify: `proxy.ts`
- Create: `lib/sites/serve.ts`, `app/(site)/[[...path]]/route.ts`, `app/(site)/holding.ts` (holding page HTML, EN/ZH)
- Test: `tests/sites-serve-db.test.ts`, `tests/proxy-host.test.ts`

**Interfaces:**

- Produces:
  - `resolve(host: string, path: string): Promise<{ kind: 'page'; pageId: string; html: string; css: string; site: SiteRow } | { kind: 'redirect'; to: string } | { kind: 'holding'; language: 'en'|'zh' }>`
  - `renderDocument(page, site): string` — full HTML document: `<title>`/description/Open Graph from `seo` (page overrides site), favicon, `<link rel=alternate hreflang>` when a linked language page exists, enabled pixels (Meta/Google/LinkedIn/TikTok base codes only, ids from settings), `/site/runtime.js`, page CSS and HTML.
  - `PUBLIC_HOST = 'ai.thelead.io'`; `isPublicHost(host: string): boolean` (also `*.localhost` preview host `site.localhost` for dev).
  - Response headers on pages: `Cache-Control: public, max-age=0, must-revalidate`, `Netlify-CDN-Cache-Control: public, s-maxage=31536000, stale-while-revalidate=60`, `Netlify-Cache-Tag: page:<pageId>`, CSP (§11 of spec: `default-src 'self'; script-src 'self' https://connect.facebook.net https://www.googletagmanager.com https://snap.licdn.com https://analytics.tiktok.com https://challenges.cloudflare.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com https://challenges.cloudflare.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com`), `X-Robots-Tag: noindex` when `seo.noindex`.
- `proxy.ts`: on a public host, rewrite every path except `/api/site/*`, `/site/*` (static runtime) and `/_next/*` to `app/(site)` and **never** run the Supabase session refresh or the sign-in redirect; app routes answer 404 there. On other hosts, behaviour unchanged, plus `/sites/preview/<pageId>` (signed in) renders the draft with `noindex`.

- [ ] **Step 1: Write failing tests** — **`unknown path on ai.thelead.io returns the holding page with 404, not a sign-in redirect`** (Review Focus 1); `a redirect route answers 301 to its target`; `/automations on ai.thelead.io is 404`; `a published page returns its html with the cache tag and CSP`; `SEO title and Meta pixel id from settings appear in the document, other pixels do not`; `proxy on the app host still redirects a signed-out visitor to /sign-in`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**; then `npm run build` succeeds.
- [ ] **Step 5: Commit**

---

### Task 8: CRM API client and attribution rules

**Files:**

- Create: `lib/sites/crm-api.ts`, `lib/crm/attribution.ts` (copied from lead_crm `app/(public)/attribution.ts`, header comment naming the source)
- Test: `tests/sites-crm-api.test.ts`, `tests/attribution.test.ts`

**Interfaces:**

- Produces:
  - `crmLead(input: CrmLeadInput, ctx: { clientIp: string | null }): Promise<{ kind: 'ok'; personId: string; dealId: string | null } | { kind: 'invalid'; fields: Record<string,string> } | { kind: 'limited' } | { kind: 'captcha' } | { kind: 'error' }>` — POST `${CRM_BASE_URL}/api/public/leads`, headers `X-Api-Key: PUBLIC_API_KEY`, `X-Lead-Client-Ip`; 10 s timeout; error bodies never logged.
  - `crmRegister(input: CrmRegisterInput, ctx): Promise<{ kind: 'checkout'; url: string } | { kind: 'full' } | { kind: 'closed' } | { kind: 'invalid'; fields } | { kind: 'limited' } | { kind: 'captcha' } | { kind: 'error' }>`
  - `CrmLeadInput` mirrors lead_crm `leadSchema` field names (`idempotencyKey, formName, fullName, email, phone, companyName, jobTitle, message, preferredLanguage, courseInterest, classCode, consentMarketing, captchaToken, createDeal, attribution{…, utmId, utmAdId, landingUrl, referrer, firstTouch}`).
  - From the copy: `readTouch(cookieValue: string | undefined): Touch | null`, `touchFromUrl(url: URL, referrer: string | null, now: Date): Touch | null`, cookie names `lead_first_touch`, `lead_last_touch`, 90 days.
- Env: `CRM_BASE_URL` (e.g. `https://theleadiocrm.netlify.app`), `PUBLIC_API_KEY`.

- [ ] **Step 1: Write failing tests** (fetch faked) — request URL, headers and body shape; CRM 422 → `invalid` with fields; 429 → `limited`; 403 captcha → `captcha`; network error/timeout → `error`; attribution copy: same cases as lead_crm's attribution tests (copy them).
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 9: Stats and Meta CAPI

**Files:**

- Create: `lib/sites/stats.ts`, `app/api/site/view/route.ts`, `lib/sites/capi.ts`, `scripts/capi-run.ts`
- Modify: `.github/workflows/schedule.yml` (job `capi`: `node scripts/capi-run.ts`, env `DATABASE_URL`, `META_CAPI_TOKEN`, `META_PIXEL_ID`)
- Test: `tests/sites-stats-db.test.ts`, `tests/sites-capi-db.test.ts`

**Interfaces:**

- Produces:
  - `recordView(pageId: string, variant: string, visitorId: string, now: Date): Promise<void>` — `visitorHash = sha256(PAGE_VIEW_SALT + visitorId + day)`; first sighting per day bumps `uniques`. `visitorId` is a random first-party cookie `lead_vid` (365 days).
  - `siteStats(viewer, siteId, from: string, to: string): Promise<StepStats[]>`, `StepStats = { pageId; name; views; uniques; optins; optinRate; orders; revenueMyr; avgOrderMyr; earningsPerView }` — opt-ins = CRM `touchpoint` rows with this site's form names in range; orders/revenue = CRM `payment` (succeeded, net of refunds) whose enrolment's deal `source_touchpoint_id` has a `landing_url` on this step's path.
  - `queueCapi(name: 'PageView' | 'Lead' | 'InitiateCheckout' | 'Purchase', e: { eventId: string; eventTime: Date; sourceUrl: string; fbc?: string; fbp?: string; email?: string; phone?: string; consent: boolean; valueMyr?: number; clientIp?: string; userAgent?: string }): Promise<void>` — hashes email/phone (sha256, normalised) **only when `consent`**; `fbc = fb.1.<ms>.<fbclid>`.
  - `drainCapi(now: Date, fetchImpl?): Promise<{ sent: number; failed: number }>` — batches ≤ 1000 to `graph.facebook.com/v21.0/<META_PIXEL_ID>/events`, `action_source: 'website'`; 5 attempts with backoff (1, 5, 30, 120, 720 min); `META_TEST_EVENT_CODE` added when set.
  - `Purchase`: `drainCapi` also scans CRM payments (succeeded, last 7 days) tied to a site step (same join as stats) and queues one `Purchase` per payment (`eventId = 'purchase:' + payment.id`).

- [ ] **Step 1: Write failing tests** — `two views by one visitor on one day = 2 views, 1 unique`; `stats count opt-ins and revenue for the step that produced them`; `Lead without consent sends no email/phone hash`; `same event_id is queued once`; `a 500 from Meta retries later, a 400 fails after logging the status only`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 10: LEAD form endpoint

**Files:**

- Create: `lib/sites/forms.ts`, `app/api/site/form/route.ts`
- Test: `tests/sites-forms-db.test.ts`

**Interfaces:**

- Consumes: Tasks 3, 6, 8, 9.
- Produces: `submitForm(raw: { pageId: string; formId: string; fullName; email; phone; companyName?; jobTitle?; message?; consentMarketing: boolean; idempotencyKey: string; captchaToken?: string; firstTouch?: string; lastTouch?: string; landingUrl: string; referrer: string | null }, ctx: { clientIp: string | null; crm?: typeof crmLead }): Promise<{ kind: 'ok'; after: LeadFormSettings['after'] } | { kind: 'invalid'; fields } | { kind: 'limited' } | { kind: 'captcha' } | { kind: 'not_found' } | { kind: 'error'; whatsapp: string }>`
- Settings come from the **published** version's form element (`data-lead="form" data-id=<formId>`, settings JSON in `data-settings`), never from `raw`. Draft pages → `not_found`.
- Queues CAPI `Lead` (Task 9) on `ok`.

- [ ] **Step 1: Write failing tests** — `workshop form sends the generated form name and createDeal from settings`; `form name in the request body is ignored`; **`same idempotency key twice reaches the CRM with the same key and both answer ok`** (Review Focus 5); `a draft page refuses submissions`; `CRM error answers with the WhatsApp link and logs no personal data`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 11: Order form (checkout step) endpoint

**Files:**

- Create: `lib/sites/checkout.ts`, `app/api/site/checkout/route.ts`, `app/api/site/class/[code]/route.ts` (public: price, seats left, dates — read from lead_crm `/api/public/schedule`)
- Test: `tests/sites-checkout-db.test.ts`

**Interfaces:**

- Consumes: Tasks 3, 6, 8, 9.
- Produces: `submitOrder(raw: { pageId; formId; fullName; email; phone; companyName?; consentMarketing; idempotencyKey; captchaToken?; firstTouch?; lastTouch?; landingUrl; referrer }, ctx): Promise<{ kind: 'redirect'; url: string } | { kind: 'full' } | { kind: 'closed' } | { kind: 'invalid'; fields } | { kind: 'limited' } | { kind: 'captcha' } | { kind: 'not_found' } | { kind: 'error'; whatsapp: string }>`
- `returnUrl` = the site's `thank_you` step URL on `ai.thelead.io`. Queues CAPI `InitiateCheckout` on `redirect`.

- [ ] **Step 1: Write failing tests** — `order sends classCode from the published page and the funnel's thank-you returnUrl`; **`CRM full answer shows "This class is full" and no redirect`** (Review Focus 4); `closed class`; `class code in the request body is ignored`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 12: Public runtime script

**Files:**

- Create: `public/site/runtime.js` (plain JS, no framework, < 8 KB minified), `lib/sites/runtime-copy.ts` (EN/ZH strings it uses)
- Test: `tests/sites-runtime.test.ts` (pure functions exported for test via a small `lib/sites/runtime-core.ts` that the script build copies)

**Interfaces:**

- Behaviour on every published page: write first/last-touch cookies (rules from Task 8), send view beacon (`POST /api/site/view` `{pageId, variant}` with `navigator.sendBeacon`), wire `[data-lead=form]` and `[data-lead=order]` submit (idempotency key = `crypto.randomUUID()` per form render, disable button while sending, show field errors / messages), FAQ toggle, image slider, number counter, Turnstile widget when `data-turnstile` present.
- Copy (EN/ZH): "This class is full", "Too many tries — please try again in a few minutes", "Something went wrong — please WhatsApp us", "Thank you! We'll be in touch." — exact strings in `runtime-copy.ts`.

- [ ] **Step 1: Write failing tests** — touch cookie written only when the URL carries UTM or a click id; last touch overwritten, first kept; submit payload shape; error kind → message mapping.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit**

---

### Task 13: Admin screens (lists, funnel, settings, stats, history)

**Files:**

- Create: `app/(app)/sites/page.tsx` (tabs Funnels | Websites (disabled until phase 2), folders, search), `app/(app)/sites/funnel/[id]/page.tsx` (tabs Steps, Stats, Settings, SEO), `app/(app)/sites/funnel/[id]/actions.ts`, `app/(app)/sites/templates/page.tsx`, `app/(app)/sites/sections/page.tsx`
- Modify: `app/(app)/nav.ts` — "Sites & forms" leaves "Phase 4", links to `/sites` for `canViewSites` roles.
- Test: browser check (Step 4) + action tests in `tests/sites-admin-db.test.ts`

**Interfaces:**

- Consumes: Tasks 4, 6, 9. Server actions call those functions only; every action re-checks permission server-side (hidden buttons are not checks).

- [ ] **Step 1: Write failing action tests** — `operations cannot call the publish action`; `settings action returns conflict on stale version`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement screens** — match SalesProcess's layout: steps list left, step panel right (Edit, Preview, Open live, path, clone/delete); Stats table columns exactly as spec §9.
- [ ] **Step 4: Verify in browser** (local dev, `.claude/launch.json`): create funnel from template, rename a step, change path, view stats; screenshot.
- [ ] **Step 5: Commit**

---

### Task 14: GrapesJS editor with LEAD components

**Files:**

- Modify: `package.json` (`grapesjs` exact version; `sanitize-html` is added in Task 5)
- Create: `app/(app)/sites/editor/[pageId]/page.tsx` (server: permission, draft, lock), `app/(app)/sites/editor/editor.tsx` (client, `ssr: false`), `app/(app)/sites/editor/components/*.ts` (one file per component group), `app/(app)/sites/editor/panels.ts`, `lib/sites/images.ts` + `app/api/site/image/route.ts` (moved from #29), `db` seed: `scripts/seed-site-templates.ts` (3 starter templates rebuilt from live GHL pages, `[placeholder]` copy)
- Test: `tests/sites-components.test.ts` (component definitions export the right `data-lead` markers and default settings), browser check

**Interfaces:**

- Components (GrapesJS types, each outputs plain HTML + classes; interactive ones carry `data-lead`): `lead-section`, `lead-row`, `lead-column`, `lead-nested-column`, `lead-heading`, `lead-subheading`, `lead-paragraph`, `lead-rich-text`, `lead-bullet-list`, `lead-image`, `lead-image-slider` (`data-lead="slider"`), `lead-svg`, `lead-divider`, `lead-button` (link: URL, step, or `#form`), `lead-number-counter` (`data-lead="counter"`), `lead-social-icons`, `lead-logo-showcase`, `lead-faq` (`data-lead="faq"`), `lead-nav-menu`, `lead-form` (`data-lead="form"`, settings = `LeadFormSettings`, consent field non-removable), `lead-order-form` (`data-lead="order"`, settings = `OrderFormSettings`, shows live price/seats from `/api/site/class/<code>`), `lead-register-button`, `lead-whatsapp-button`, `lead-global-section` (reference by id, rendered at publish).
- Panels: Add (Rows, Elements, Prebuilt sections = templates of kind `section`, Saved assets = global sections), Layers, Style (brand palette first; fonts: Inter, Poppins, Noto Sans SC, Noto Serif SC, Montserrat), Settings; devices desktop 1280 / tablet 768 / phone 375; undo/redo; autosave every 5 s via `saveDraft` (conflict → banner "Changed by someone else — reload"); Preview; Publish (shows `publishCheck` reasons or `removed` warnings).
- No custom-code component; GrapesJS code import disabled.

- [ ] **Step 1: Write failing component tests**
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**; run `scripts/seed-site-templates.ts` locally.
- [ ] **Step 4: Browser verification** — rebuild one live page (`/en/courses/ai-full-stack-building-certification`) from the starter template on phone and desktop; publish; open on `site.localhost` dev host; submit the form (CRM API pointed at a local lead_crm); screenshot each.
- [ ] **Step 5: Commit**

---

### Task 15: Deploy, domain and end-to-end check

**Files:**

- Modify: `.env.example` (`CRM_BASE_URL`, `PUBLIC_API_KEY`, `PAGE_IMAGE_BUCKET`, `SUPABASE_SERVICE_ROLE_KEY`, `PAGE_VIEW_SALT`, `NETLIFY_PURGE_TOKEN`, `META_PIXEL_ID`, `META_CAPI_TOKEN`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`), `docs/` runbook section in the spec's §13 checklist

- [ ] **Step 1:** Merge lead_crm Task 1 PR; set `PUBLIC_ALLOWED_ORIGINS` unchanged (server-to-server needs none); create the new `PUBLIC_API_KEY` value in lead_crm and lead_sales Netlify env (Shawn adds values; never printed).
- [ ] **Step 2:** Apply migration 006 on production (`db:migrate` dry run, then `--apply`).
- [ ] **Step 3:** Add `ai.thelead.io` as a domain alias on Netlify site `theleadsales` (certificate pending until DNS moves; test meanwhile with a temporary host `pages-test.thelead.io` or the Netlify alias).
- [ ] **Step 4:** End-to-end on production with the test host: workshop funnel → lead in CRM with UTM and `utm_campaign_id`, Home count +1; paid funnel → Stripe **test mode** checkout → Thank You step; Meta Test Events shows PageView, Lead, InitiateCheckout; stats show the views and opt-in. Delete the test lead afterwards.
- [ ] **Step 5:** Commit runbook; open PR; deploy; tell marketing the editor is ready (27 Nov).
