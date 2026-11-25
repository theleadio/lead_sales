-- lead_sales migration 008: email marketing (build plan phase 3).
--
-- A campaign is one newsletter: its words, and who it goes to (tags and a
-- language, always limited to people whose latest `marketing_email` consent
-- is a grant). Sending a campaign queues one row per person in email_send; a
-- background job (scripts/email-run.ts) sends the queue through Resend in
-- batches and re-checks consent just before each send.

CREATE TABLE IF NOT EXISTS sales.email_campaign (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app_user(id),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  subject         text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  -- NULL: every language.
  language        text CHECK (language IN ('en', 'zh')),
  body_html       text NOT NULL DEFAULT '' CHECK (length(body_html) <= 200000),
  -- Any of these tags; empty: no tag filter.
  tag_ids         uuid[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sending', 'sent')),
  queued_at       timestamptz,
  sent_at         timestamptz,
  recipient_count integer
);

CREATE TABLE IF NOT EXISTS sales.email_send (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id  uuid NOT NULL REFERENCES sales.email_campaign(id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES person(id),
  -- The address as it was when the campaign was queued.
  email        text NOT NULL,
  status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  attempts     integer NOT NULL DEFAULT 0,
  -- Status text only: Resend's error body can echo the address.
  error        text,
  sent_at      timestamptz,
  -- A person gets a campaign at most once, however often it is queued.
  UNIQUE (campaign_id, person_id)
);
CREATE INDEX IF NOT EXISTS email_send_queue
  ON sales.email_send (campaign_id, status);
