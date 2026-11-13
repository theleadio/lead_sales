-- lead_sales migration 006: landing pages (Sites & forms).
--
-- A page is a title, a public address (/p/<slug>) and an ordered list of
-- blocks (hero, text, image, video, testimonials, FAQ, form, button). The
-- blocks are checked by lib/pages/model.ts on every save. A new page starts
-- as a draft: only staff see it until it is published.
-- (005 is the imported-message flag in PR #20.)

CREATE TABLE IF NOT EXISTS sales.page (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES app_user(id),
  -- Lower-case words joined by hyphens, up to four parts ("cn/workshop/x"),
  -- so a page can keep the path its SalesProcess funnel had.
  slug         text NOT NULL UNIQUE
                 CHECK (length(slug) <= 120 AND slug ~
                   '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){0,3}$'),
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  language     text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'zh')),
  blocks       jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(blocks) = 'array'),
  published    boolean NOT NULL DEFAULT false
);
