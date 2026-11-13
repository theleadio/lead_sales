-- lead_sales migration 006: sites & funnels (phase 1).
--
-- A site is a funnel or a website: ordered pages, each with versions (one
-- draft per variant; published ones are history). site_route is the live
-- routing table, written only by publish / unpublish / redirect; the public
-- renderer reads nothing else.

CREATE TABLE IF NOT EXISTS sales.site_folder (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('funnel','website')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales.site (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('funnel','website')),
  name        text NOT NULL,
  folder_id   uuid REFERENCES sales.site_folder(id),
  domain      text NOT NULL DEFAULT 'ai.thelead.io',
  base_path   text NOT NULL,
  language    text NOT NULL CHECK (language IN ('en','zh')),
  settings    jsonb NOT NULL DEFAULT '{}',
  created_by  uuid REFERENCES app_user(id),
  updated_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sales.site_page (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid NOT NULL REFERENCES sales.site(id) ON DELETE CASCADE,
  position           integer NOT NULL,
  name               text NOT NULL,
  path               text NOT NULL,
  kind               text NOT NULL DEFAULT 'page'
                       CHECK (kind IN ('page','checkout','thank_you')),
  active_version_id  uuid,
  edit_lock_user_id  uuid REFERENCES app_user(id),
  edit_lock_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  UNIQUE (site_id, position)
);

CREATE TABLE IF NOT EXISTS sales.page_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id       uuid NOT NULL REFERENCES sales.site_page(id) ON DELETE CASCADE,
  variant       text NOT NULL DEFAULT 'A',
  project       jsonb NOT NULL DEFAULT '{}',
  html          text NOT NULL DEFAULT '',
  css           text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','archived')),
  published_by  uuid REFERENCES app_user(id),
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS page_version_one_draft
  ON sales.page_version (page_id, variant) WHERE status = 'draft';

-- Live routing. page_id is not cascaded: unpublish removes the row first.
CREATE TABLE IF NOT EXISTS sales.site_route (
  domain       text NOT NULL,
  path         text NOT NULL CHECK (path = '/' OR path ~
                 '^/([a-z0-9]+(-[a-z0-9]+)*)(/[a-z0-9]+(-[a-z0-9]+)*){0,4}$'),
  page_id      uuid REFERENCES sales.site_page(id),
  redirect_to  text,
  PRIMARY KEY (domain, path)
);

CREATE TABLE IF NOT EXISTS sales.global_section (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  project     jsonb NOT NULL DEFAULT '{}',
  html        text NOT NULL DEFAULT '',
  css         text NOT NULL DEFAULT '',
  version     integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales.site_template (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('funnel','website','section')),
  name        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales.page_view_day (
  page_id  uuid NOT NULL REFERENCES sales.site_page(id) ON DELETE CASCADE,
  variant  text NOT NULL,
  day      date NOT NULL,
  views    integer NOT NULL DEFAULT 0,
  uniques  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, variant, day)
);

-- Dedupe for "uniques"; rows older than 2 days are deleted.
CREATE TABLE IF NOT EXISTS sales.page_view_seen (
  page_id       uuid NOT NULL REFERENCES sales.site_page(id) ON DELETE CASCADE,
  day           date NOT NULL,
  visitor_hash  text NOT NULL,
  PRIMARY KEY (page_id, day, visitor_hash)
);

-- Outbound conversion events, retried until sent.
CREATE TABLE IF NOT EXISTS sales.capi_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         text NOT NULL UNIQUE,
  name             text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','sent','failed')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
