-- lead_sales migration 001: CRM ↔ LMS hand-off
-- (docs/specs/2026-11-04-crm-to-lms-handoff.md). Decided 4 Nov (evening):
-- lead_sales sends the LMS its notices. The CRM's own event worker takes
-- every row of its event_outbox, so lead_sales can't share that queue; it
-- watches CRM tables instead and keeps its own queue here.

-- Where the watcher has read up to, per source. It re-reads a short overlap
-- each run (a row can commit after a later one), and the unique source_key
-- below makes the overlap harmless.
CREATE TABLE IF NOT EXISTS sales.lms_cursor (
  name        text PRIMARY KEY,
  read_until  timestamptz NOT NULL
);

-- One notice to the LMS. source_key says what caused it (a status-history
-- row, a class fingerprint, a contact change), so the same cause never
-- queues twice. The id is the message's messageId, which the LMS uses to
-- ignore repeats.
CREATE TABLE IF NOT EXISTS sales.lms_notice (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  kind             text NOT NULL CHECK (kind IN
                     ('enrolment.confirmed','enrolment.cancelled',
                      'enrolment.transferred','class.updated','person.updated')),
  ref_id           uuid NOT NULL,
  extra            jsonb NOT NULL DEFAULT '{}',
  source_key       text NOT NULL UNIQUE,
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  skipped_reason   text,
  dead_at          timestamptz,
  last_error       text,
  CHECK (sent_at IS NULL OR dead_at IS NULL)
);
CREATE INDEX IF NOT EXISTS lms_notice_due_idx ON sales.lms_notice (next_attempt_at)
  WHERE sent_at IS NULL AND dead_at IS NULL AND skipped_reason IS NULL;

-- What the LMS was last told about a person and a class, so the watcher
-- sends a contact or class change only when something it holds changed.
CREATE TABLE IF NOT EXISTS sales.lms_person_sent (
  person_id   uuid PRIMARY KEY,
  email       text,
  phone_e164  text,
  full_name   text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sales.lms_class_sent (
  class_id     uuid PRIMARY KEY,
  fingerprint  text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now()
);
