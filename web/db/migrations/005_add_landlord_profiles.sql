-- Landlord portfolio tracking: cross-references a building's officer
-- (the real person behind an LLC, lib/landlords.ts) against every other
-- registration_id that same officer + business address appears on
-- citywide, then aggregates violations across all those buildings.
-- See lib/landlordProfile.ts.

-- Split name fields, needed to query feu5-w2e2 by firstname/lastname
-- (Socrata's own schema shape) rather than re-parsing the combined display
-- name lib/landlords.ts already stores in officer_name.
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS officer_firstname TEXT;
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS officer_lastname TEXT;

CREATE TABLE IF NOT EXISTS landlord_profiles (
  landlord_key TEXT PRIMARY KEY, -- normalized officer_name|business_address
  officer_name TEXT NOT NULL,
  business_address TEXT,
  building_count INTEGER NOT NULL DEFAULT 0,
  total_violation_count INTEGER NOT NULL DEFAULT 0,
  total_rent_impairing_count INTEGER NOT NULL DEFAULT 0,
  avg_years_open DOUBLE PRECISION NOT NULL DEFAULT 0,
  raw_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  rating DOUBLE PRECISION NOT NULL DEFAULT 0,
  building_ids TEXT[] NOT NULL DEFAULT '{}',
  building_addresses TEXT[] NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
