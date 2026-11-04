# lead_sales

LEAD's own sales platform, replacing SalesProcess. Version 1 covers:

- inbox and tickets
- automations
- websites and forms
- email marketing
- the social planner
- payments

Contacts, deals, classes and enrolments stay in [`lead_crm`](https://github.com/theleadio/lead_crm). Both apps share one Supabase database and one sign-in.

**Specs:** in `lead_crm`, `docs/superpowers/specs/2026-11-04-*.md` (PR #39). Start with `2026-11-04-lead-sales-build-plan.md`.

## Ground rules (build plan §2)

1. **Same stack as `lead_crm`:** Next.js 16, Supabase auth, raw SQL with `postgres`, Tailwind, Netlify. This Next.js has breaking changes, so read `node_modules/next/dist/docs/` before writing code (`AGENTS.md`).
2. **One login.** Staff sign in with their CRM account; `app_user` and its role come from the shared database.
3. **Own tables in the `sales` schema only.** Migrations are in `db/migrations/NNN_name.sql`. `npm run db:migrate` refuses a file that creates or alters anything outside `sales`. The CRM's tables change only through `lead_crm` migrations, with Shawn's review.
4. **Never write CRM tables directly.** People, deals, enrolments and payments are written through CRM code (internal CRM endpoints). Reading them is fine.
5. **Brand:** white, bright, Apple-like.
   - Logo blue `#A1BACE` and yellow `#FBE33B` are fills with **dark** text, and accents. White text on them fails WCAG AA; `tests/brand.test.ts` checks this.
   - Primary buttons are charcoal `#3D3D3D` until marketing picks a darker blue.
6. **Develop against staging,** a separate Supabase project with fake data, never production (decided 4 Nov).
7. **No secrets or customer data** in git or in CI logs.

## Run it

```bash
cp .env.example .env.local    # fill in the STAGING Supabase values
npm install
npm run db:migrate            # dry run: lists pending migrations
npm run db:migrate -- --apply
npm run dev
```

Sign in with a CRM account whose `app_user` row is active and linked through `auth_user_id`.

## Checks

```bash
npm run lint
npm run typecheck
npm test
```

CI (`.github/workflows/ci.yml`) runs the same three on every PR.

## Phases (build plan §3)

| Phase | What                                                | Status        |
| ----- | --------------------------------------------------- | ------------- |
| 0     | Setup: shell, sign-in, brand, `sales` schema, CI    | this scaffold |
| 1     | Inbox + tickets; Meta Lead Ads intake               | —             |
| 2     | Automations; Stripe webhook (in `lead_crm`, PR #41) | —             |
| 3     | Email marketing + social planner                    | —             |
| 4     | Sites, landing pages, forms                         | —             |
| 5     | AI support                                          | —             |
| 6     | Switch off SalesProcess                             | —             |

**Builders:** Zhixuan and Shawn.

## Not done in phase 0

- **Sign-in audit and lockout.** `lead_crm` logs every sign-in and locks an account after 5 failures, using its `audit_log` table. `lead_sales` can't write that table (rule 4), so this needs a decision before go-live: a `sales.audit_log`, or an internal CRM endpoint.
- **Netlify site.** Someone with Netlify access has to create one for this repo (`netlify.toml` is ready), with the three env vars from `.env.example`.
