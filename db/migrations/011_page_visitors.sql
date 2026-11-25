-- lead_sales migration 011: count each visitor once over a date range.
--
-- Until now page_view_seen held a hash salted per day, so a visitor could not
-- be matched across days and Stats added up daily uniques (someone back on
-- another day counted twice). Decided 25 Nov 2026: from now on the hash is
-- salted per deployment only (sha256(PAGE_VIEW_SALT + the lead_vid cookie)),
-- kept 90 days, so Stats can count distinct visitors over a range. No IP,
-- name or email is stored. Rows written before this keep stable = false and
-- are still deleted after 2 days; days before the first stable row keep using
-- the daily uniques in page_view_day.

ALTER TABLE sales.page_view_seen
  ADD COLUMN IF NOT EXISTS stable boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS page_view_seen_stable_day
  ON sales.page_view_seen (page_id, day) WHERE stable;
