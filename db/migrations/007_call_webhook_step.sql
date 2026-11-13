-- lead_sales migration 007: the "call a webhook" automation step
-- (lib/automations/webhook.ts). Adds one allowed value to the step kinds of
-- migration 004; nothing else changes and no row is touched.
-- (005 is PR #20's imported-message flag; 006 is the landing pages table.)

ALTER TABLE sales.automation_step
  DROP CONSTRAINT IF EXISTS automation_step_kind_check;
ALTER TABLE sales.automation_step
  ADD CONSTRAINT automation_step_kind_check CHECK (kind IN
    ('add_tag','remove_tag','create_task','wait','stop_if_replied',
     'send_email','send_whatsapp','call_webhook'));
