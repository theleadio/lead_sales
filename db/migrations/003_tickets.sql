-- lead_sales migration 003: inbox and tickets
-- (docs/specs/2026-11-04-inbox-tickets-design.md §3).
--
-- Conversations and messages are lead_sales' own (decided 4 Nov: it never
-- writes the CRM's message_log). Teams are new: the CRM has no Finance or
-- Tech role, so a team is a list of app_user rows, and one person can be in
-- several teams.

-- ---- Teams --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sales.team (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  -- Finance tickets can hold invoice data: only the team itself, plus
  -- super_admin and management, may open a restricted team's tickets (§6).
  restricted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Exactly one team takes everything no category or rule claims.
CREATE UNIQUE INDEX IF NOT EXISTS team_one_default
  ON sales.team (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS sales.team_member (
  team_id           uuid NOT NULL REFERENCES sales.team(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES app_user(id),
  -- Round robin gives the next ticket to whoever was given one longest ago.
  last_assigned_at  timestamptz,
  -- clock_timestamp(): members added in one transaction still keep their order.
  added_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (team_id, user_id)
);

-- Members (Mischa, JM, Qi En; Support to be named) are added in Settings,
-- by their app_user accounts.
INSERT INTO sales.team (code, name, is_default, restricted) VALUES
  ('finance',    'Finance',    false, true),
  ('tech',       'Tech',       false, false),
  ('operations', 'Operations', false, false),
  ('support',    'Support',    true,  false)
ON CONFLICT (code) DO NOTHING;

-- ---- Categories and rules -----------------------------------------------------

CREATE TABLE IF NOT EXISTS sales.ticket_category (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label_en  text NOT NULL,
  label_zh  text,
  team_id   uuid NOT NULL REFERENCES sales.team(id),
  -- Suggested from words in a message (v1 only suggests, never routes).
  keywords  text[] NOT NULL DEFAULT '{}',
  active    boolean NOT NULL DEFAULT true,
  position  integer NOT NULL DEFAULT 100
);

INSERT INTO sales.ticket_category (code, label_en, label_zh, team_id, keywords, position)
SELECT c.code, c.label_en, c.label_zh, t.id, c.keywords, c.position
FROM (VALUES
  ('einvoice', 'E-invoice', '电子发票', 'finance', ARRAY['e-invoice','einvoice','invoice','发票'], 10),
  ('receipt',  'Receipt',   '收据',     'finance', ARRAY['receipt','收据'], 20),
  ('voucher',  'Voucher',   '优惠券',   'tech',    ARRAY['voucher','coupon','优惠券'], 30),
  ('api_key',  'API key',   'API 密钥', 'tech',    ARRAY['api key','apikey','api-key'], 40),
  ('general',  'General',   '一般',     'support', ARRAY[]::text[], 1000)
) AS c(code, label_en, label_zh, team_code, keywords, position)
JOIN sales.team t ON t.code = c.team_code
ON CONFLICT (code) DO NOTHING;

-- Ordered; the first matching rule wins. With no matching rule, a ticket
-- goes to its category's team, round robin.
CREATE TABLE IF NOT EXISTS sales.ticket_rule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position        integer NOT NULL,
  match_channel   text CHECK (match_channel IN ('whatsapp','email','messenger','instagram','web_form','manual')),
  match_category  text REFERENCES sales.ticket_category(code),
  set_team_id     uuid REFERENCES sales.team(id),
  assign_mode     text NOT NULL DEFAULT 'round_robin'
                    CHECK (assign_mode IN ('round_robin','fixed','none')),
  assign_user_id  uuid REFERENCES app_user(id),
  active          boolean NOT NULL DEFAULT true,
  CHECK (assign_mode <> 'fixed' OR assign_user_id IS NOT NULL)
);

-- ---- Working days -------------------------------------------------------------

-- National plus KL/Selangor public holidays (decided 4 Nov). Not seeded:
-- the dates (several follow the moon) are entered in Settings each year from
-- the official gazette.
CREATE TABLE IF NOT EXISTS sales.holiday (
  day   date PRIMARY KEY,
  name  text NOT NULL
);

-- ---- Conversations and messages -----------------------------------------------

CREATE TABLE IF NOT EXISTS sales.conversation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  person_id           uuid NOT NULL REFERENCES person(id),
  channel             text NOT NULL CHECK (channel IN ('whatsapp','email','messenger','instagram','web_form')),
  external_thread_id  text NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','snoozed','closed')),
  assigned_user_id    uuid REFERENCES app_user(id),
  last_message_at     timestamptz,
  -- The composer warns when the free-reply window (WhatsApp, Messenger)
  -- has closed since this.
  last_inbound_at     timestamptz,
  UNIQUE (channel, external_thread_id)
);
CREATE INDEX IF NOT EXISTS conversation_recent
  ON sales.conversation (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS sales.message (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  conversation_id      uuid NOT NULL REFERENCES sales.conversation(id),
  person_id            uuid NOT NULL REFERENCES person(id),
  channel              text NOT NULL CHECK (channel IN ('whatsapp','email','messenger','instagram','web_form')),
  direction            text NOT NULL CHECK (direction IN ('in','out')),
  external_message_id  text,
  body                 text,
  -- Files live in storage; only their paths are kept here.
  attachment_paths     text[] NOT NULL DEFAULT '{}',
  sent_by_user_id      uuid REFERENCES app_user(id),
  sent_at              timestamptz NOT NULL DEFAULT now(),
  status               text NOT NULL DEFAULT 'received'
                         CHECK (status IN ('received','queued','sent','delivered','read','failed')),
  UNIQUE (channel, external_message_id)
);
CREATE INDEX IF NOT EXISTS message_by_conversation
  ON sales.message (conversation_id, sent_at);

-- ---- Tickets ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS sales.ticket_number_seq;

CREATE TABLE IF NOT EXISTS sales.ticket (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(id),
  number              text NOT NULL UNIQUE
                        DEFAULT 'T-' || lpad(nextval('sales.ticket_number_seq')::text, 6, '0'),
  person_id           uuid NOT NULL REFERENCES person(id),
  conversation_id     uuid REFERENCES sales.conversation(id),
  source_channel      text NOT NULL CHECK (source_channel IN ('whatsapp','email','messenger','instagram','web_form','manual')),
  category            text NOT NULL REFERENCES sales.ticket_category(code),
  team_id             uuid NOT NULL REFERENCES sales.team(id),
  assigned_user_id    uuid REFERENCES app_user(id),
  status              text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','open','waiting_customer','resolved','closed')),
  priority            text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  subject             text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  sla_due_at          timestamptz NOT NULL,
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  -- A customer reply on a resolved ticket opens a new one linked here
  -- (decided 4 Nov); the old one stays closed.
  previous_ticket_id  uuid REFERENCES sales.ticket(id)
);
CREATE INDEX IF NOT EXISTS ticket_open_by_team
  ON sales.ticket (team_id, sla_due_at) WHERE status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS ticket_by_assignee
  ON sales.ticket (assigned_user_id) WHERE status NOT IN ('resolved','closed');

-- Append-only history: creation, status, reassignment, category, notes.
CREATE TABLE IF NOT EXISTS sales.ticket_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- clock_timestamp(), not now(): events written in one transaction (a
  -- follow-up closes the old ticket and creates the new one) keep their order.
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  ticket_id   uuid NOT NULL REFERENCES sales.ticket(id),
  user_id     uuid REFERENCES app_user(id),
  kind        text NOT NULL CHECK (kind IN ('created','status','assigned','category','note','first_response')),
  before      jsonb,
  after       jsonb,
  note        text CHECK (note IS NULL OR length(note) <= 5000)
);
CREATE INDEX IF NOT EXISTS ticket_event_by_ticket
  ON sales.ticket_event (ticket_id, created_at);

CREATE OR REPLACE FUNCTION sales.ticket_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sales.ticket_event is append-only';
END $$;
DROP TRIGGER IF EXISTS ticket_event_append_only ON sales.ticket_event;
CREATE TRIGGER ticket_event_append_only
  BEFORE UPDATE OR DELETE ON sales.ticket_event
  FOR EACH ROW EXECUTE FUNCTION sales.ticket_event_append_only();
