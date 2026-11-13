# Sites & Funnels: replacing the SalesProcess page builder

Status: draft for Shawn's review, 13 Nov 2026. Owner: Shawn. Repo: `lead_sales`.

## 1. Why

SalesProcess (GoHighLevel) is switched off on 14 Dec 2026. Its funnels serve LEAD's course and workshop
pages on **`ai.thelead.io`** (e.g. `/en/courses/ai-full-stack-building-certification`, `/claude-ai-mastery`,
`/cn/workshop/claude-ai-masterclass`), take card payments, count opt-ins and sales per step, and send
website events to Meta. Ads, bio links and WhatsApp replies point at those addresses. When SalesProcess
goes, all of that goes with it.

This spec replaces the funnel and website builder inside `lead_sales`, at **parity with SalesProcess
Funnels and Websites**, without moving the deadline.

## 2. Decisions (Shawn, 13 Nov)

| #   | Decision                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Pages live in `lead_sales` (reverses "site builder out of scope" in the cutover plan; 10 Nov decision confirmed).                                   |
| D2  | **Parity target: SalesProcess Funnels + Websites.** Forms/Surveys/Quizzes builder, Blogs, Chat widget and QR codes are not in scope.                |
| D3  | **Marketing edits pages with free layout** (drag and drop, like SalesProcess), not fixed blocks.                                                    |
| D4  | Editor: **GrapesJS** (open source, MIT) embedded in `lead_sales`; #29's block builder is the fallback (§13).                                        |
| D5  | **Same domain and paths**: `ai.thelead.io/<path>` moves from SalesProcess to `lead_sales` on cutover.                                               |
| D6  | **Payments stay in the CRM**: the Payment Form step uses the CRM's class checkout (Stripe, seat reservation, payment record). No new payment logic. |
| D7  | All four page kinds needed by 14 Dec: free workshop sign-up, paid class page, lead magnet / interest form, course info page.                        |
| D8  | **ASAP, no slipping**: phase 1 live 27 Nov (before the 30 Nov parallel run); the rest by 11 Dec (§11).                                              |

## 3. What SalesProcess does today (read 13 Nov, read-only)

- **61 funnels** in folders ("01 - AI Agentic Automation Certification", …), ~22 edited since September.
- A course funnel is **3 steps: Home → Payment Form → Thank You**, each with its own path.
  Example (EN AI Full-Stack, 13 Oct–13 Nov): Home 1,489 views / 1,034 unique; Payment Form 135 views,
  10 opt-ins, **7 orders, RM 24,192**; Thank You 8 views.
- **Funnel tabs:** Steps (with split-test variations), Stats, Sales, Security, Events, SEO & AEO, Settings.
- **Settings:** domain, path, favicon, head/body tracking code, chat widget, live/test payment mode,
  image optimisation, GDPR-safe fonts, auto schema.
- **Events:** server-side Meta events for pixel `613351752149959` (page view, initiate checkout, +1).
- **Editor:** sections → rows → columns → nested columns; ~40 elements (text, form, blog, media, custom
  code, survey, quiz, calendar, map, SVG, reviews, number counter, QR, pricing table, countdown/minute/day
  timers, navigation menu, divider, progress bar, image feature, social icons, Instagram feed, order form,
  order confirmation); prebuilt sections; saved assets / global sections ("lead footer - en"); Ask AI
  (assist / build); device views; version history; preview; publish.
- **Elements actually used on 7 live LEAD pages:** section, row, column, nested column, heading,
  sub-heading, paragraph, rich text, bullet list, image, image slider, SVG, divider, button, number
  counter, social icons, logo showcase, FAQ, navigation menu, form, custom code (1–2 per page).

## 4. Phases and dates

| Phase                | Done by                  | Scope                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. First slice**   | **Fri 27 Nov**           | Funnels with steps and folders; editor with every element in §3's "actually used" list; global sections; templates; LEAD form + UTM (§7, §8); Payment Form step via CRM checkout (§7.3); Thank You step; per-step stats (§9); Meta Conversions API for the website pixel (§10); SEO meta; publish history and rollback; `ai.thelead.io` serving (§5.3) |
| **2. Websites**      | **Fri 4 Dec**            | Website type: many pages, shared navigation/header/footer, free paths, site-wide settings                                                                                                                                                                                                                                                              |
| **3. Parity extras** | **Fri 11 Dec**, in order | (a) countdown, minute and day timers; (b) video, photo gallery, testimonials, reviews, pricing table, map, calendar embed, QR code, progress bar, image feature; (c) split tests; (d) order bumps and upsell steps; (e) schema markup (Course, FAQ, Organization) at publish; (f) AI build and copy assist (Claude API)                                |
| **4. On request**    | —                        | Survey, quiz, blog posts, Instagram feed                                                                                                                                                                                                                                                                                                               |

Cutover (§13) depends only on phase 1. Phase 3 items not done by 11 Dec ship after cutover.

## 5. Architecture

### 5.1 Where things run

- **Editor and admin screens:** `lead_sales` app, `/sites`, behind sign-in (Netlify site `theleadsales`).
- **Public pages:** the same Netlify site, reached on **`ai.thelead.io`**. `proxy.ts` routes by host:
  on `ai.thelead.io` only the public page route, the form/checkout endpoints, the view beacon and assets
  are reachable; every app route answers 404. On the app host, `/p/...` preview works for signed-in staff.
- Sign-in cookies are host-only on the app host, so they are **never sent to `ai.thelead.io`**: marketing-
  authored HTML never runs where a session exists.
- A published page is stored HTML + CSS, served with long CDN caching and purged on publish.

### 5.2 Talking to the CRM

Lead capture and checkout go through **lead_crm's public API, server to server**, not through copies:

- `POST lead_crm /api/public/leads` (exists): person, dedupe, touchpoint with attribution, consent, deal,
  `LeadCaptured`.
- `POST lead_crm /api/public/register` (exists): seat check and reservation, deal, Stripe Checkout session.
- The `X-Api-Key` (`PUBLIC_API_KEY`) stays on the server; the browser only ever talks to `ai.thelead.io`.
- **lead_crm changes needed (small, one PR):**
  1. `register` accepts an optional `returnUrl` (allow-listed to `https://ai.thelead.io/`), used as Stripe's
     `success_url` / `cancel_url`, so payment returns to the funnel's Thank You step.
  2. `leads` accepts `utmId` / `utmAdId` → `touchpoint.utm_campaign_id` / `utm_ad_id` (migration 015 columns).
  3. Optional `createDeal: false` on `leads`, if #27 decides workshop sign-ups open no deal.
  4. `/register` and both endpoints accept the `ft` first-touch hand-off (§8.3).

### 5.3 Domain

`ai.thelead.io` is on Cloudflare DNS. Before cutover it is added to Netlify site `theleadsales` as a domain
alias with its certificate issued; at cutover the DNS record moves from SalesProcess to Netlify (§13).

## 6. Data model (migration 006, replaces #29's `sales.page`)

| Table                  | Columns (main)                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales.site_folder`    | id, name, kind (`funnel`/`website`)                                                                                                                                                                                        |
| `sales.site`           | id, kind, name, folder_id, domain (default `ai.thelead.io`), base_path, language (`en`/`zh`), settings jsonb (favicon, pixels, CAPI on/off, chat widget, payment mode, SEO defaults), created/updated by and at, `version` |
| `sales.site_page`      | id, site_id, position (step order), name, path (unique per domain), kind (`page`, `checkout`, `thank_you`), active_version_id, `version`                                                                                   |
| `sales.page_version`   | id, page_id, variant (`A` default; more in phase 3c), project jsonb (GrapesJS), html, css, status (`draft`/`published`/`archived`), published_by, published_at, created_at                                                 |
| `sales.global_section` | id, name, project jsonb, html, css, `version`                                                                                                                                                                              |
| `sales.site_template`  | id, kind (`funnel`/`website`/`section`), name, payload jsonb                                                                                                                                                               |
| `sales.page_view_day`  | page_id, variant, day (KL date), views, uniques — primary key (page_id, variant, day)                                                                                                                                      |

- Path uniqueness is per domain across all sites; a path collision blocks publish.
- `version` columns give the same optimistic-concurrency rule as the CRM (§7 of the CRM spec): a stale save
  is refused, never silently overwritten.
- Only `sales` schema objects (the migrate script enforces it).

## 7. Editor

### 7.1 Screens

- **Sites** → tabs **Funnels** | **Websites**, folders, search; per funnel: name, steps, last updated, live
  address, 7-day views and opt-ins.
- **Funnel** → tabs **Steps** (add, reorder, clone, delete; per step: Edit, Preview, Open live, path),
  **Stats** (§9), **Settings** (§5.1 settings), **SEO**.
- **Editor** (full screen, GrapesJS): top bar with back, "Saved 10:42", step switcher, desktop / tablet /
  phone, zoom, undo/redo, history, preview, publish. Left: Add (Rows, Elements, Prebuilt sections, Saved
  assets), Layers. Right: Style (brand palette first, approved font list incl. Chinese-capable) and element
  Settings.
- **Templates** and **Global sections** lists.

### 7.2 Elements

Phase 1 = every element in §3's "actually used" list, as GrapesJS components with LEAD styling defaults,
plus:

- **LEAD form** — the only element that creates a lead. Settings: type (_workshop sign-up_: title, date,
  language → form name `LEAD - <title> <d Mon YYYY>`, which lead_crm's `parseWorkshopForm` reads; _interest /
  lead magnet_: free form name; _class enquiry_: course or class), fields (name, email, phone; optional
  company, job title, message), marketing-consent tickbox (always present, unticked), "open a deal" switch,
  after-submit (message or go to step / URL).
- **Order form** (checkout step) — class picker from CRM public classes, shows price and seats left from the
  CRM; fields name, email, phone (+ company for HRDF); submit → §7.3.
- **Register button** — links to the funnel's checkout step, or to CRM `/register/<classCode>` when used
  outside a funnel.
- **WhatsApp button** — `wa.me` link, prefilled text carrying the page's campaign so the chat is attributed.
- **Custom code** — _not_ offered (security, §11). The tracking it carried today is replaced by site settings
  (pixels) and §10.

Phase 3 adds the remaining SalesProcess elements (§4).

### 7.3 Payment Form step

1. Visitor submits the Order form on `ai.thelead.io/<funnel>/<checkout-path>`.
2. The server reads the class and form settings from the **published** page (never from the request), then
   calls lead_crm `POST /api/public/register` with the details, attribution and
   `returnUrl = https://ai.thelead.io/<funnel>/<thank-you-path>`.
3. lead_crm reserves the seat and creates the Stripe Checkout session; the visitor is redirected to Stripe,
   pays, and returns to the Thank You step. The CRM's Stripe webhook confirms the enrolment as today.
4. Full class / closed class / validation errors show inline; a server failure shows "Something went wrong,
   please WhatsApp us" with the WhatsApp link.

Phase 3d adds order bumps (an add-on product on the order form) and upsell steps (one-click offer after
payment, using the same CRM checkout).

### 7.4 Save and publish

- Autosave to the draft every few seconds; one editor per page at a time ("Winnie is editing — open read-only
  or take over").
- **Preview**: private link, `noindex`.
- **Publish checks** (refuse with a clear reason): privacy-notice link present; every LEAD/Order form
  configured; workshop date not in the past; path free; images within limits; HTML passes the cleaner (§11).
- **History**: every publish kept; "Restore" any version; every publish/unpublish/restore audited.
- **Unpublish**: the path shows the holding page ("This event has ended — see upcoming classes"), never a 404.

## 8. Lead capture and UTM tracking

### 8.1 Submission path

Browser → `POST ai.thelead.io/api/forms/<pageId>/<formId>` → server reads settings from the published page →
guards (10/min per keyed IP fingerprint, 3/h per email or phone, Cloudflare Turnstile once configured,
idempotency key) → lead_crm `POST /api/public/leads` → thank-you message or redirect. No personal data in
URLs or logs.

### 8.2 What is recorded (on the CRM `touchpoint`, channel `web_form`)

| From                                                                  | Column                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | same                                                      |
| `utm_id`, `utm_ad_id`                                                 | `utm_campaign_id`, `utm_ad_id` (exact join to Meta spend) |
| `fbclid`, `gclid`, `gbraid`, `wbraid`, `li_fat_id`, `ttclid`          | same                                                      |
| page address (only UTM / click-id parameters kept)                    | `landing_url`                                             |
| referrer                                                              | `referrer`                                                |
| form name                                                             | `form_name`                                               |

### 8.3 First and last touch

`lead_first_touch` / `lead_last_touch` cookies (90 days, `SameSite=Lax`, host-only), the same rules as
lead_crm's public pages (copied into `lead_sales/lib/crm/`, "keep in step"). The submission records the last
touch; a different first touch becomes the person's first-touch row. The Order form and Register button pass
both touches to the CRM checkout (`ft` parameter), so revenue is credited to the campaign that brought the
visitor.

### 8.4 Ad link templates (for marketing)

- **Meta:** `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_id={{campaign.id}}&utm_ad_id={{ad.id}}`
- **Google:** auto-tagging on (`gclid`) + `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}`
- **LinkedIn:** `utm_source=linkedin&utm_medium=paid&utm_campaign=<name>` (`li_fat_id` automatic)
- **TikTok:** `utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__` (`ttclid` automatic)
- **Organic:** `utm_source=instagram&utm_medium=bio`, `utm_source=whatsapp&utm_medium=broadcast`, …

## 9. Stats

Per step and variant, for a date range (KL days):

| Column                            | Source                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Views, Uniques                    | `sales.page_view_day`: a small beacon on each public page; unique = salted hash of a first-party visitor id per day, no IP stored |
| Opt-ins, opt-in rate              | CRM touchpoints with this page's form names in range                                                                              |
| Orders, revenue, avg. order value | CRM payments (succeeded, net of refunds) whose register call came from this step                                                  |
| Earnings per page view            | revenue ÷ views                                                                                                                   |

Same columns as SalesProcess's Stats tab, so the team reads it the same way.

## 10. Meta Conversions API (website pixel)

Replaces SalesProcess's Events tab for pixel `613351752149959`:

- **PageView** — from the view beacon (server side).
- **Lead** — after a successful LEAD form submission.
- **InitiateCheckout** — when the Order form hands off to Stripe.
- **Purchase** — when the CRM confirms the payment (value net MYR).

Each event carries `event_id` (deduplicates with the browser pixel), `fbc` built from `fbclid` and click time,
`fbp` when the pixel cookie exists, and hashed email/phone **only for Lead/Purchase and only with marketing
consent**. Sent through a queue with retries, like the CRM's integration events; a Meta outage never blocks a
page or a form. Token `META_CAPI_TOKEN` (already has access to this pixel). The browser pixel itself loads only
where the site's settings switch it on.

## 11. Security

- Public pages served on `ai.thelead.io`, where no session cookie exists (§5.1).
- **HTML cleaner at publish**: strips `<script>`, `on*` handlers, `javascript:`/`data:` URLs, `<iframe>`
  except YouTube/Vimeo/Google Maps embeds, `<object>`, `<embed>`, `<form>` other than ours, `<base>`, `<meta
http-equiv>`. Tested against a list of known attack strings.
- **Content-Security-Policy** on `ai.thelead.io`: scripts only from self and the allowed pixel/Turnstile
  hosts; frames only from the allowed embed hosts.
- **Publish rights**: marketing, management, super_admin. Sales and operations view and preview.
- **Images**: Supabase Storage public bucket; server checks type (jpg/png/webp/svg-sanitised) and size (5 MB);
  random file names.
- Form endpoints: server-side settings, rate limits, CAPTCHA, idempotency (§8.1); the CRM API key never
  reaches the browser.

## 12. PDPA

- Marketing consent tickbox always present and unticked; wording from the CRM's consent text (EN/ZH).
- Privacy-notice link required on every published page (publish blocked without it).
- Cookies hold campaign values, landing address and time only. Whether they count as functional storage is for
  LEAD's privacy reviewer to confirm (open question carried from lead_crm §10.2).
- Meta CAPI: hashed email/phone only with marketing consent; never in URLs or logs.

## 13. Cutover (ai.thelead.io)

1. 27 Nov: phase 1 deployed; `ai.thelead.io` added to Netlify, certificate ready; marketing starts rebuilding.
2. 30 Nov–11 Dec: every live SalesProcess funnel rebuilt and published (checklist of ~22 funnels with owner and
   status); each checked: page renders on phone, form creates a CRM lead with UTM, checkout reaches Stripe test
   mode and returns to Thank You, Meta Test Events shows PageView/Lead.
3. 12 Dec: path map — every old SalesProcess path either has a page or a redirect to the nearest live page.
4. 13 Dec night: DNS for `ai.thelead.io` switched to Netlify; spot-check the top 10 paths and one live payment
   (refunded).
5. 14 Dec: SalesProcess switched off per the cutover plan.

**Fallback:** if the GrapesJS editor isn't solid by **4 Dec**, the remaining pages for 14 Dec are built with #29's
block builder on the same public serving, and moved to the editor later.

## 14. Testing

- Unit: HTML cleaner (attack list), page settings schemas, workshop form-name generation round-trips through
  lead_crm's `parseWorkshopForm`, attribution parsing, CSP header.
- DB tests (local test DB): save with stale version refused; publish checks; path collision; unpublish holding
  page; form submission calls the CRM API with the right body (CRM API faked); view counting and uniques.
- lead_crm tests for its four API changes (§5.2).
- Browser, on the deploy preview then production: build a workshop funnel from a template, publish, submit,
  see the lead + UTM in the CRM and the count on Home; a paid funnel through Stripe test checkout to Thank You;
  Meta Test Events.

## 15. Open items

1. Who can change `ai.thelead.io` DNS on Cloudflare on 13 Dec.
2. The list of SalesProcess funnels needed on 14 Dec, with an owner each (marketing).
3. #27: does a workshop sign-up open a deal?
4. Turnstile site/secret key; LEAD privacy-notice URL; the CRM consent text in ZH.
5. `PUBLIC_API_KEY` for lead_sales → lead_crm (new key, server only).
6. Privacy reviewer: first/last-touch cookies as functional storage.
