-- lead_sales migration 005: sales.message.imported
-- (SalesProcess cutover plan WP5, rule "imports never fire events").
--
-- Set by the WhatsApp history import (lib/wati/history.ts). The automations
-- trigger "customer message received" skips imported rows, so copying old
-- chats in never starts a flow, even a chat from minutes ago that a nightly
-- delta brings in. The import also stamps created_at with the message's own
-- time, so nothing looks new to the watchers either.
ALTER TABLE sales.message
  ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false;
