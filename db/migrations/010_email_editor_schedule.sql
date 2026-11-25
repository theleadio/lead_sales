-- lead_sales migration 010: email marketing, second slice.
--
-- blocks:       the campaign as editor blocks (heading, text, image, button,
--               divider). NULL for a campaign written as raw HTML. When set,
--               body_html is generated from it on every save.
-- scheduled_at: when a scheduled campaign is queued by the email job.
-- note:         why a scheduled campaign went back to draft instead of out
--               (for example no one matched at the scheduled time).
--
-- New status 'scheduled': draft -> scheduled -> sending -> sent, and
-- scheduled -> draft when someone cancels it or the job can't send it.

ALTER TABLE sales.email_campaign
  ADD COLUMN IF NOT EXISTS blocks jsonb
    CHECK (blocks IS NULL OR jsonb_typeof(blocks) = 'array'),
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS note text
    CHECK (note IS NULL OR length(note) <= 500);

ALTER TABLE sales.email_campaign
  DROP CONSTRAINT IF EXISTS email_campaign_status_check;
ALTER TABLE sales.email_campaign
  ADD CONSTRAINT email_campaign_status_check
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent'));
ALTER TABLE sales.email_campaign
  ADD CONSTRAINT email_campaign_scheduled_time
    CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS email_campaign_due
  ON sales.email_campaign (scheduled_at) WHERE status = 'scheduled';
