-- Building owner/landlord lookups. registrationid already exists per
-- violation row in the HPD dataset (wvxf-dwi5) but wasn't being persisted
-- until now. Joins to HPD's Registration Contacts dataset (feu5-w2e2) via
-- registration_id give owner/agent/officer names — see lib/landlords.ts.

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS registration_id TEXT;
CREATE INDEX IF NOT EXISTS idx_buildings_registration_id ON buildings(registration_id);

-- Cached separately from buildings (not inlined as more buildings columns)
-- since multiple buildings can share one registration_id, and this data
-- comes from a different Socrata dataset/schema entirely.
CREATE TABLE IF NOT EXISTS landlords (
  registration_id TEXT PRIMARY KEY,
  owner_name TEXT,
  owner_type TEXT,
  officer_name TEXT,
  agent_name TEXT,
  business_address TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
