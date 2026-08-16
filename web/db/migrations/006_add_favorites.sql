-- Favorites: a signed-in user can save a building (buildings.building_id)
-- or a landlord profile (landlord_profiles.landlord_key) against their
-- firebase_uid. One polymorphic table (resource_type discriminator +
-- opaque resource_key), not two near-identical tables — see spec 019's
-- Schema decision: both keys are already opaque TEXT primary keys in their
-- own tables with identical save/unsave semantics.
--
-- resource_key has no DB-level foreign key to buildings/landlord_profiles
-- (deliberate) — a save must survive even if the referenced row is later
-- dropped/re-synced by the data-loader, matching how landlord_profiles
-- itself is a best-effort cache, not a stable join target. The query lib
-- (lib/favorites.ts) is responsible for tolerating a missing join match.
CREATE TABLE IF NOT EXISTS favorites (
  id SERIAL PRIMARY KEY,
  firebase_uid TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('building', 'landlord')),
  resource_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (firebase_uid, resource_type, resource_key)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(firebase_uid);
