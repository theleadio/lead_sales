# Email marketing

Build plan phase 3, first slice (25 Nov 2026). Newsletter campaigns to people
who agreed to marketing email. Screen: **Email marketing** (`/email`), for
`super_admin`, `management` and `marketing`.

## How it works

1. **Write** a campaign: name, subject, language (or everyone), optional tags,
   and the email as HTML. `{{name}}` becomes the person's name. The body is
   sanitised (no scripts, https links and images only) and an unsubscribe link
   is always added at the bottom.
2. **Test**: "Save and email me a test" sends one copy to your own address.
3. **Preview**: the screen shows how many people the saved filters reach.
4. **Send**: ticking the box and pressing Send queues one row per person in
   `sales.email_send`. The `email` job in `.github/workflows/schedule.yml`
   (`npm run email:run`, every 5 minutes) sends them in batches of 100 through
   Resend's batch API. Large lists therefore take a few runs.

## Who is emailed

A person is emailed only if **all** of these hold:

- their latest `marketing_email` consent row is a grant (no row means no);
- they are not deleted, erased or merged, and have an email address;
- they match the campaign's tags (any of) and language.

Consent is checked again just before each batch, so someone who unsubscribes
after a campaign is queued is skipped, not emailed. A person is queued at most
once per campaign.

On 25 Nov 2026 the production database held **no** `marketing_email` consent
rows, so nothing can be sent until some exist. New consent comes from website
and Meta form sign-ups that tick the marketing box (`lib/crm/leads.ts`), and
from the import below.

## Importing people who already opted in elsewhere

Only for a list you know consists of people who agreed to marketing email, for
example SalesProcess's subscribed list. **Never** import a list of "all
contacts".

```bash
# one email per line (a header line "email" is fine); a dry run by default
npm run consent:import -- --file subscribed.csv --source salesprocess-subscribed-2026-11
# happy with the counts? write them
npm run consent:import -- --file subscribed.csv --source salesprocess-subscribed-2026-11 --apply
```

- Each grant is stored with source `import:<source>`, so it can be traced.
- Someone whose latest consent is a **withdrawal** is skipped, never re-granted.
- Addresses with no matching person are counted and ignored.
- It prints counts only. Run it against the database you mean to change:
  `DATABASE_URL` in `.env.local` is used.

## Unsubscribing

Every email carries `List-Unsubscribe` (one-click) headers and a footer link to
`/api/email/unsubscribe?t=<token>`. The link only shows a confirm button
(mail scanners open links); pressing it, or a mail app's one-click, records a
consent **withdrawal** row (source `unsubscribe_link`) and raises the CRM's
`ConsentChanged` event. Tokens are signed with `EMAIL_UNSUBSCRIBE_SECRET` and
never expire. **Do not change that secret after sending**, or old emails'
links stop working.

## Setup before the first real send

Set these in **Netlify** (the app) and in **GitHub Actions secrets** (the job).
The `email` job skips itself until all are set.

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | Resend API key (already used by automations) |
| `EMAIL_FROM` | a sender on the verified domain, e.g. `LEAD <hello@thelead.io>` |
| `APP_BASE_URL` | `https://theleadsales.netlify.app`, no trailing slash |
| `EMAIL_UNSUBSCRIBE_SECRET` | a long random string |
| `DATABASE_URL` | already a secret for the other jobs |

Then run `npm run db:migrate -- --apply` for migration 008.

## Not in this slice

A visual email editor, open and click statistics, scheduling for later,
resending to failures, and drip sequences (Automations covers those).
