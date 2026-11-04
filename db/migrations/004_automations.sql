-- lead_sales migration 004: automations
-- (docs/specs/2026-11-04-automations-design.md §3).
--
-- An automation is a trigger, conditions and ordered steps. Each time its
-- trigger fires for a person it starts one run; a run works through the
-- steps, sleeping at a "wait" step until next_run_at. Every step's outcome
-- is logged. New automations start paused: nothing runs until someone
-- switches it on.

CREATE TABLE IF NOT EXISTS sales.automation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES app_user(id),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  trigger     text NOT NULL CHECK (trigger ~ '^[A-Za-z]{3,40}$'),
  -- [{"field": "person.preferred_language", "op": "eq", "value": "zh"}, …]
  conditions  jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(conditions) = 'array'),
  -- The kill switch: off stops new runs and holds the waiting ones.
  active      boolean NOT NULL DEFAULT false,
  -- When it was last switched on: only causes from then on start runs, so
  -- switching on never fires it for something that happened before.
  active_since  timestamptz
);

CREATE TABLE IF NOT EXISTS sales.automation_step (
  automation_id  uuid NOT NULL REFERENCES sales.automation(id) ON DELETE CASCADE,
  position       integer NOT NULL CHECK (position BETWEEN 1 AND 50),
  kind           text NOT NULL CHECK (kind IN
                   ('add_tag','remove_tag','create_task','wait','stop_if_replied',
                    'send_email','send_whatsapp')),
  settings       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
  PRIMARY KEY (automation_id, position)
);

CREATE TABLE IF NOT EXISTS sales.automation_run (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  automation_id  uuid NOT NULL REFERENCES sales.automation(id) ON DELETE CASCADE,
  person_id      uuid NOT NULL REFERENCES person(id),
  -- What started it (an outbox event, a ticket, a message, an LMS notice).
  -- Unique per automation: a re-read or replayed trigger never starts a
  -- second run.
  source_key     text NOT NULL,
  context        jsonb NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','waiting','done','stopped','failed')),
  next_step      integer NOT NULL DEFAULT 1,
  next_run_at    timestamptz NOT NULL DEFAULT now(),
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text,
  finished_at    timestamptz,
  UNIQUE (automation_id, source_key)
);
CREATE INDEX IF NOT EXISTS automation_run_due
  ON sales.automation_run (next_run_at) WHERE status IN ('running','waiting');

-- Append-only: what each step did, or why it was skipped.
CREATE TABLE IF NOT EXISTS sales.automation_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  run_id    uuid NOT NULL REFERENCES sales.automation_run(id) ON DELETE CASCADE,
  position  integer,
  outcome   text NOT NULL CHECK (outcome IN
              ('started','done','skipped','waiting','stopped','failed','retry')),
  detail    text CHECK (detail IS NULL OR length(detail) <= 1000)
);
CREATE INDEX IF NOT EXISTS automation_log_by_run ON sales.automation_log (run_id, at);

-- Where the trigger watcher has read up to, per source.
CREATE TABLE IF NOT EXISTS sales.automation_cursor (
  name        text PRIMARY KEY,
  read_until  timestamptz NOT NULL
);
