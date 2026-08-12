-- Column-for-column translation of web/lib/db.ts's initSchema() (SQLite) to Postgres.
-- REAL -> DOUBLE PRECISION, INTEGER -> INTEGER, TEXT -> TEXT (unchanged).

CREATE TABLE IF NOT EXISTS buildings (
  building_id TEXT PRIMARY KEY,
  bin TEXT,
  bbl TEXT,
  street_name TEXT NOT NULL,
  postcode TEXT NOT NULL,
  house_number_low TEXT NOT NULL,
  house_number_high TEXT NOT NULL,
  house_number_display TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  violation_count INTEGER NOT NULL DEFAULT 0,
  rent_impairing_count INTEGER NOT NULL DEFAULT 0,
  avg_days_open INTEGER NOT NULL DEFAULT 0,
  percent_dead_end DOUBLE PRECISION NOT NULL DEFAULT 0,
  percent_reissued DOUBLE PRECISION NOT NULL DEFAULT 0,
  recurring_issue_count INTEGER NOT NULL DEFAULT 0,
  rating DOUBLE PRECISION NOT NULL DEFAULT 0, -- composite score, see lib/scoring.ts (column kept as "rating" for UI/query compat; spec 001 calls it "score")
  last_violation_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_buildings_postcode ON buildings(postcode);
CREATE INDEX IF NOT EXISTS idx_buildings_rating ON buildings(rating);

CREATE TABLE IF NOT EXISTS violations (
  violation_id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(building_id) ON DELETE CASCADE,
  postcode TEXT NOT NULL,
  house_number TEXT,
  street_name TEXT,
  inspection_date TEXT NOT NULL,
  current_status TEXT,
  violation_status TEXT NOT NULL,
  rent_impairing INTEGER NOT NULL DEFAULT 0,
  nov_description TEXT,
  nov_type TEXT,
  days_open INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_violations_building ON violations(building_id);
CREATE INDEX IF NOT EXISTS idx_violations_postcode ON violations(postcode);
