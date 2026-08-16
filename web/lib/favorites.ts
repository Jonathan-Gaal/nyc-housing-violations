// Favorites query lib (spec 019) — save/unsave/list a building or landlord
// profile against a verified firebase_uid. Mirrors the getPool()-pattern
// query functions elsewhere in this codebase (lib/landlordProfile.ts,
// lib/queries.ts): plain parameterized SQL, no ORM.
//
// No DB-level foreign key from favorites.resource_key to buildings/
// landlord_profiles (see db/migrations/006_add_favorites.sql) — every
// function here must tolerate a resource_key with no matching row rather
// than assume the join always succeeds (spec 019 Constraints/Edge Cases).
import type { Pool } from 'pg';
import type { ScoringBreakdown } from './scoring';

export type FavoriteResourceType = 'building' | 'landlord';

// Matches lib/queries.ts's BuildingRow shape exactly so spec 021's
// /favorites page can pass a saved building straight into BuildingCard
// without a second, divergent row shape.
export interface FavoriteBuildingRow {
  building_id: string;
  street_name: string;
  postcode: string;
  house_number_display: string;
  latitude: number;
  longitude: number;
  violation_count: number;
  rent_impairing_count: number;
  avg_days_open: number;
  percent_dead_end: number;
  percent_reissued: number;
  recurring_issue_count: number;
  rating: number;
  last_violation_date: string;
  scoringBreakdown: ScoringBreakdown;
  recurringIssueCount: number;
}

export interface FavoriteLandlordRow {
  landlordKey: string;
  officerName: string;
  businessAddress: string | null;
  buildingCount: number;
  rating: number;
}

export interface FavoritesList {
  buildings: FavoriteBuildingRow[];
  landlords: FavoriteLandlordRow[];
}

const DAYS_PER_YEAR = 365.25;

interface BuildingJoinRow {
  building_id: string;
  street_name: string;
  postcode: string;
  house_number_display: string;
  latitude: number;
  longitude: number;
  violation_count: number;
  rent_impairing_count: number;
  avg_days_open: number;
  percent_dead_end: number;
  percent_reissued: number;
  recurring_issue_count: number;
  rating: number;
  last_violation_date: string;
}

function toFavoriteBuildingRow(row: BuildingJoinRow): FavoriteBuildingRow {
  return {
    ...row,
    scoringBreakdown: {
      totalViolations: row.violation_count,
      rentImpairing: row.rent_impairing_count,
      avgYearsOpen: Math.round((row.avg_days_open / DAYS_PER_YEAR) * 10) / 10,
      percentDeadEnd: row.percent_dead_end,
      percentReissued: row.percent_reissued,
    },
    recurringIssueCount: row.recurring_issue_count,
  };
}

interface LandlordJoinRow {
  landlord_key: string;
  officer_name: string;
  business_address: string | null;
  building_count: number;
  rating: string;
}

function toFavoriteLandlordRow(row: LandlordJoinRow): FavoriteLandlordRow {
  return {
    landlordKey: row.landlord_key,
    officerName: row.officer_name,
    businessAddress: row.business_address,
    buildingCount: row.building_count,
    rating: Number(row.rating),
  };
}

// Left-joins each favorite's resource_key against buildings/landlord_profiles
// and drops any favorite whose resource_key no longer resolves to a row
// (spec 019 Edge Cases: a stale favorite must never crash the join, and is
// simply omitted from the response rather than surfaced as a broken entry).
export async function listFavoritesForUser(pool: Pool, firebaseUid: string): Promise<FavoritesList> {
  const buildingsResult = await pool.query<BuildingJoinRow>(
    `SELECT b.building_id, b.street_name, b.postcode, b.house_number_display, b.latitude, b.longitude,
            b.violation_count, b.rent_impairing_count, b.avg_days_open,
            b.percent_dead_end, b.percent_reissued, b.recurring_issue_count,
            b.rating, b.last_violation_date
     FROM favorites f
     JOIN buildings b ON b.building_id = f.resource_key
     WHERE f.firebase_uid = $1 AND f.resource_type = 'building'
     ORDER BY f.created_at DESC`,
    [firebaseUid]
  );

  const landlordsResult = await pool.query<LandlordJoinRow>(
    `SELECT lp.landlord_key, lp.officer_name, lp.business_address, lp.building_count, lp.rating
     FROM favorites f
     JOIN landlord_profiles lp ON lp.landlord_key = f.resource_key
     WHERE f.firebase_uid = $1 AND f.resource_type = 'landlord'
     ORDER BY f.created_at DESC`,
    [firebaseUid]
  );

  return {
    buildings: buildingsResult.rows.map(toFavoriteBuildingRow),
    landlords: landlordsResult.rows.map(toFavoriteLandlordRow),
  };
}

// Idempotent — ON CONFLICT DO NOTHING mirrors this project's existing
// idempotent-write pattern (webhooks/stripe/route.ts's setUserTier reasoning
// applied to a save/unsave toggle rather than a payment event): a
// double-click or retried POST must not error or create a duplicate row.
export async function addFavorite(
  pool: Pool,
  firebaseUid: string,
  resourceType: FavoriteResourceType,
  resourceKey: string
): Promise<void> {
  await pool.query(
    `INSERT INTO favorites (firebase_uid, resource_type, resource_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (firebase_uid, resource_type, resource_key) DO NOTHING`,
    [firebaseUid, resourceType, resourceKey]
  );
}

// Deleting a favorite that was never saved is a valid no-op, not an error
// (spec 019 Edge Cases) — a plain DELETE ... WHERE with no matching row
// already satisfies that without any special-casing.
export async function removeFavorite(
  pool: Pool,
  firebaseUid: string,
  resourceType: FavoriteResourceType,
  resourceKey: string
): Promise<void> {
  await pool.query(
    `DELETE FROM favorites WHERE firebase_uid = $1 AND resource_type = $2 AND resource_key = $3`,
    [firebaseUid, resourceType, resourceKey]
  );
}
