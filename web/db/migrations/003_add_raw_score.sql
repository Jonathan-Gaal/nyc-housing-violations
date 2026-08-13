-- Percentile-based rating (see lib/scoring.ts's recomputeCityWidePercentiles):
-- raw_score keeps the existing weighted-average formula's output, which
-- structurally can't reach the extremes of the 0-100 scale (empirically
-- clustered ~20-99.8 citywide) since it requires every one of 5 factors to
-- be simultaneously bad/good. `rating` becomes a citywide percentile rank
-- of raw_score instead, guaranteeing the full scale is actually used.

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS raw_score DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: every existing `rating` value already IS the old raw
-- weighted-average score (that's what calculateScore wrote there before
-- this migration) — copy it into raw_score so buildings loaded before this
-- migration have a real value to rank against, not the column default.
UPDATE buildings SET raw_score = rating;
