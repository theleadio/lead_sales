-- lead_sales migration 002: Meta lead forms
-- (docs/specs/2026-11-04-meta-lead-ads-intake.md §3.3).
--
-- Meta's standard questions (name, email, phone, company, job title) map on
-- their own. Each form's custom questions depend on how marketing built the
-- form, so this table says, per form, which custom question fills which CRM
-- field. A form with no row still works: its standard questions are saved
-- and the form is named by its id.
--
-- `fields` maps a Meta question key to one of the CRM lead fields below,
-- e.g. {"which_course": "courseInterest", "using_hrdc": "hrdcIntended"}.
CREATE TABLE IF NOT EXISTS sales.meta_form (
  form_id     text PRIMARY KEY,
  name        text,
  fields      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(fields) = 'object'),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
