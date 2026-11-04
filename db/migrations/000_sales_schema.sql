-- lead_sales migration 000: the `sales` schema and the runner's ledger.
-- lead_sales keeps ALL its tables in `sales`; the CRM's tables stay in
-- `public` and change only through lead_crm migrations (README ground
-- rules, Shawn's schema review). So the two migration folders can't clash.
CREATE SCHEMA IF NOT EXISTS sales;

CREATE TABLE IF NOT EXISTS sales.schema_migration (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
