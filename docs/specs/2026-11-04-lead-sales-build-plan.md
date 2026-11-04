# lead_sales build plan (draft)

**Date:** 4 Nov 2026 · **Status:** draft. The phase contents will change once the SalesProcess feature map is in · **Parent:** `2026-11-04-lead-sales-platform-design.md`

> **Decided 4 Nov (evening): every new sales-platform piece lives in this repo, `theleadio/lead_sales`, not in `lead_crm`.** That includes the Stripe webhook, the CRM ↔ LMS notices, Meta Lead Ads intake, integration health and the data checks. The earlier `lead_crm` PRs (#39, #41–#47) were closed unmerged. Where `lead_sales` must change CRM data (payments, enrolments, people, deals), it writes the shared database **directly**, following the CRM's own rules, which are copied into `lead_sales` and kept in step. The only `lead_crm` work left is the small CRM screen changes in §3, which Zhixuan does in `lead_crm`.

## 1. What we're building

`theleadio/lead_sales` is LEAD's own web app to replace SalesProcess. Version 1 covers Conversations, Automations, Funnels/Websites/Forms, Email marketing, Social planner and Payments. Contacts and deals stay in `lead_crm`, and both apps share one Supabase database.

## 2. Ground rules (decide before the first line of code)

1. **Same stack as the CRM**: Next.js 16, Supabase auth, raw SQL with `postgres`, Tailwind and shadcn, hosted on Netlify. Read `node_modules/next/dist/docs/` first: this Next.js has breaking changes (the CRM's `AGENTS.md` says so).
2. **One login.** Same Supabase project and same `app_user` roles, so staff sign in once.
3. **Separate tables.** `lead_sales` keeps its own tables in their own Postgres schema, `sales`, with its own migrations. The CRM's tables stay in `public` and are changed only through `lead_crm` migrations (and Shawn's schema review). The two migration folders can then never clash.
4. **Writing CRM data (changed 4 Nov, evening).** `lead_sales` writes CRM tables (people, deals, enrolments, payments) directly in the shared database. It must follow the CRM's own rules (status moves, seat checks, duplicate matching, consent), which are copied into `lead_sales` (e.g. `lib/crm/`) and kept in step with `lead_crm`. Database-level rules, like the seat triggers and status history, apply to both apps automatically. `lead_sales` never changes the CRM's **schema**; that stays with `lead_crm` migrations and Shawn.
5. **Brand.** White, bright, Apple-like. Logo blue `#A1BACE` and yellow `#FBE33B` go on fills with dark text and on accents, never with white text (contrast fails). Marketing still has to confirm the hex codes and choose a darker blue for buttons.
6. **Public repo hygiene.** Same as `lead_crm`: no secrets or customer data in git or in Actions logs.

## 3. Phases

**Builders:** Zhixuan and Shawn (decided 4 Nov). Each phase still needs a named owner below.

**Where:** all `lead_sales` work goes in this repo, with one branch and PR per piece (4 Nov, evening). Development and testing use a **separate staging Supabase project** with fake data and test WATI, Meta and Stripe accounts, never production (decided 4 Nov). Whoever is building checks `lead_crm` for rule changes every week, so the copied CRM rules stay in step.

| Phase | Delivers | Needs first | Done when |
|---|---|---|---|
| **0. Setup** | Repo, auth, app shell and navigation, brand theme, CI (lint, typecheck, tests), Netlify deploy, `sales` schema with its migration runner | Repo created; Supabase access | A staff member signs in and sees an empty Inbox page on a preview deploy |
| **1. Inbox + tickets** | WATI WhatsApp in and out, website help form, tickets with Finance/Tech/Support routing, next-working-day deadlines and a holiday list | WATI API access; Finance and Tech member names; help-form captcha choice | A test WhatsApp message lands in the inbox, becomes a Finance ticket, and is answered from the app |
| **1b. Meta Lead Ads** | Leadgen webhook → fetch → CRM intake | Meta app and permissions; Shawn agrees on Option B; Alicia's form list | A test lead from Meta's testing tool appears in the CRM once, with ad attribution |
| **2. Automations** | Rule engine, waits, logs; onboarding, new-lead and class-reminder flows | Email service chosen; WATI templates approved; LMS endpoint live | A confirmed test enrolment gets the onboarding email and WhatsApp exactly once |
| **2b. Stripe webhook** (in `lead_sales`) | Payment recorded → enrolment confirmed → LMS notice | Owner agreed (Shawn?); test keys | A test-mode payment confirms the enrolment, and the LMS gets the notice |
| **3. Email marketing + social planner** | Newsletter campaigns with consent checks; scheduled posts to social channels; image library | Feature map; email service; social account access | A test campaign goes only to consented contacts; a test post is published on schedule |
| **4. Funnels / websites / forms** | Page builder or templates, forms feeding the CRM intake, the own website | Feature map; brand guide; domain | A landing page form creates a lead in the CRM with UTM attribution |
| **5. AI support** | Suggested replies and categories; answers first and hands off to a ticket | Phase 1 live; an approved knowledge base | AI drafts are suggested in the inbox; a person always confirms |
| **6. Switch-off** | Move remaining data and flows off SalesProcess | All the above | SalesProcess no longer needed day to day |

Phases 1 and 1b can run in parallel, and so can 2 and 2b.

## 4. What must exist outside the code

- **Accounts and keys:** WATI API, Meta app, an email service, the Stripe webhook secret, social accounts. All go in env secrets; the repo stays clean.
- **Decisions still open:** the full list is in the parent spec §5 and in each module's draft.
- **The SalesProcess feature map** from the REA session, especially for phases 3 and 4.

## 5. Risks

- **Two apps, one database:** a wrong write from `lead_sales` breaks the CRM. The copied CRM rules (ground rule 4) and the database's own triggers are the guard. When a CRM rule changes in `lead_crm`, the copy here must change too.
- **WhatsApp and Meta rules change** (templates, reply windows, App Review). Check against current Meta docs at each phase.
- **Scope:** SalesProcess has many features. Build what the feature map shows the team actually uses, not everything.
