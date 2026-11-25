# Social planner

Build plan phase 3, first slice (25 Nov 2026). Plan social posts on a calendar,
keep an image library, and post to LEAD's **Facebook Page** automatically.
Every other channel is posted by hand. Screen: **Social planner** (`/social`),
for `super_admin`, `management` and `marketing`.

## How it works

1. **Write** a post: text, an optional link, up to 10 images from the library
   (in the order you pick them), its channels and a date and time. All times
   are Malaysia time.
2. **Schedule** it. "Save draft" keeps it as a draft, and nothing goes out.
3. At its time:
   - **Facebook Page**: the `social` job in `.github/workflows/schedule.yml`
     (`npm run social:run`, every 5 minutes) posts it, once the Facebook
     secrets are set (see Setup). A post can therefore go out up to about 5
     minutes late, or later when GitHub delays a scheduled run. If it still
     isn't out **15 minutes** after its time (auto-posting isn't set up yet,
     or the job is behind), it moves to **Needs you** like any other channel,
     to post by hand.
   - **Every other channel** (Instagram, LinkedIn, TikTok, YouTube, X): the
     post shows under **Needs you** on the planner. **Copy text** copies the
     words (with the link), and **Image 1, 2, …** download the images in
     order. Someone posts it by hand, then presses **Mark posted**
     (optionally pasting the link to the live post).
4. Once any channel has gone out, the post is locked: it can't be changed or
   deleted.

Views: month, week and a 30-day list. The image library is at
`/social/library`.

## Facebook posting

| Post has | Graph API call |
|---|---|
| Text (and a link) | `POST /{page-id}/feed` with `message`, `link` |
| One image | `POST /{page-id}/photos` with `url`, `caption` (the link goes in the caption) |
| Several images | each image `POST /{page-id}/photos` with `published=false`, then `POST /{page-id}/feed` with `message` and `attached_media` |

Facebook fetches each image from its public link, so the images live in the
public Supabase Storage bucket the Sites editor already uses
(`PAGE_IMAGE_BUCKET`), under `social/`. JPG and PNG only, up to 4 MB each.

What the job does when something goes wrong:

- **Facebook busy, unreachable or rate-limiting**: tried again on the next
  run, up to 3 attempts, then **Failed**.
- **Any other refusal** (for example a missing permission): **Failed** at
  once, with Facebook's reason on the post.
- **More than 12 hours late** (for example the job was off): not posted on its
  own, because what it says may no longer be true. It is marked Failed;
  **Retry** moves it to now and posts it.
- **Cut off mid-post** (the job crashed): after 15 minutes it is marked
  Failed, not posted again, because it may already be live. Check the Page
  before pressing Retry.

A failed post shows under **Needs you** with **Retry**, and with "I posted it
by hand" for when someone posts it themselves.

## Setup

1. Run migration `009_social_planner.sql`
   (`npm run db:migrate`, then `npm run db:migrate -- --apply`).
2. Make sure `PAGE_IMAGE_BUCKET`, `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` are set in Netlify (they already are if Sites
   image upload works).
3. In **GitHub Actions secrets** (not Netlify: only the job posts):
   - `FACEBOOK_PAGE_ID`: the Page's numeric id.
   - `FACEBOOK_PAGE_TOKEN`: a **Page** access token that can publish. Meta
     calls the permission `pages_manage_posts`, and it usually comes with
     `pages_read_engagement`. Verify the exact permissions in Meta's current
     docs, because Meta changes them. A long-lived Page token (from a
     long-lived user token, or a System User in Business Manager) avoids it
     expiring after an hour or two.
   - `META_GRAPH_VERSION` (optional, defaults to `v25.0`).

   Until both are set, the job is skipped, and Facebook posts are handed to a
   person 15 minutes after their time.

   On 25 Nov 2026 the token checked had no `pages_manage_posts`, so Facebook
   is posted by hand for now (Shawn's call).

The existing `META_PAGE_ACCESS_TOKEN` is for reading lead-ad leads. It is
**not** reused here, because it may not be allowed to publish. If one token
does both, set the same value in `FACEBOOK_PAGE_TOKEN`.

## Not in this slice

- Automatic posting to Instagram (needs more Meta permissions, and probably
  App Review), LinkedIn, TikTok, YouTube or X.
- Post analytics, comments, approval steps and recurring posts.
- Editing an image (crop, resize) in the app.
