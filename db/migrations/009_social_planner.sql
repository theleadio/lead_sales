-- lead_sales migration 009: social planner (build plan phase 3).
--
-- A post is one piece of social content: its words, an optional link, its
-- images, and when it should go out. It goes to one or more channels; each
-- channel has its own row in social_post_channel, because each one is posted
-- (and can fail) on its own. Facebook Page posts are published by a
-- background job (scripts/social-run.ts); every other channel is posted by a
-- person, who then marks it posted.
--
-- Images live in a public Supabase Storage bucket (PAGE_IMAGE_BUCKET, the
-- same one the Sites editor uses, under social/); social_media is the
-- library of them.

CREATE TABLE IF NOT EXISTS sales.social_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  -- The public https link Facebook fetches the image from.
  url         text NOT NULL CHECK (url ~ '^https://'),
  storage_key text NOT NULL UNIQUE,
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  bytes       integer NOT NULL CHECK (bytes > 0),
  -- The uploader's file name, to find it again in the library.
  name        text NOT NULL DEFAULT '' CHECK (length(name) <= 200),
  -- Hidden from the library. The file stays, so posts that used it still work.
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS social_media_library
  ON sales.social_media (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sales.social_post (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES app_user(id),
  body         text NOT NULL DEFAULT '' CHECK (length(body) <= 5000),
  link         text CHECK (link IS NULL OR link ~ '^https?://'),
  -- In the order they are shown; at most 10 (Facebook's multi-photo limit is
  -- higher, but 10 is what the planner offers).
  media_ids    uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(media_ids) <= 10),
  -- NULL while it is a draft with no time yet.
  scheduled_at timestamptz,
  -- draft: being written, nothing goes out. scheduled: goes out at
  -- scheduled_at. Whether it went out is per channel.
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'scheduled')),
  CHECK (status = 'draft' OR scheduled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS social_post_when
  ON sales.social_post (scheduled_at);

CREATE TABLE IF NOT EXISTS sales.social_post_channel (
  post_id      uuid NOT NULL REFERENCES sales.social_post(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN
                 ('facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x')),
  -- pending: not out yet. publishing: the job is posting it right now (a row
  -- left here by a crash is not retried on its own, because the post may
  -- already be live). posted / failed: final until someone retries.
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'publishing', 'posted', 'failed')),
  attempts     integer NOT NULL DEFAULT 0,
  -- A short reason only; never a token or a whole API answer.
  error        text,
  started_at   timestamptz,
  posted_at    timestamptz,
  -- Who marked a manual channel posted; NULL when the job posted it.
  posted_by    uuid REFERENCES app_user(id),
  -- The platform's id and link for the live post, when known.
  external_id  text,
  external_url text CHECK (external_url IS NULL OR external_url ~ '^https?://'),
  PRIMARY KEY (post_id, channel)
);
CREATE INDEX IF NOT EXISTS social_post_channel_due
  ON sales.social_post_channel (channel, status);
