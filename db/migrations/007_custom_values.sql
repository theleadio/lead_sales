-- lead_sales migration 007: custom values ({{key}} tokens in site pages).

CREATE TABLE IF NOT EXISTS sales.custom_value (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label       text NOT NULL,
  value       text NOT NULL DEFAULT '',
  updated_by  uuid REFERENCES app_user(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);
