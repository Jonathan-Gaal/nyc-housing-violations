import type { Pool, PoolClient } from 'pg';
import type { ScoringBreakdown } from './scoring';

// Accepts either a pooled connection or a single client checked out of the
// pool (e.g. loadIntoDb.ts's transaction client) — both expose the same
// `.query()` shape used by every function in this module.
type Queryable = Pool | PoolClient;

interface BuildingRowRaw {
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

// scoringBreakdown / recurringIssueCount cover specs/001's Building shape
// (percentDeadEnd, percentReissued, avgYearsOpen, recurringIssueCount).
// recurringIssueCount is Phase 2 per that spec — surfaced for dashboard
// exploration now, not yet weighted into the score.
export interface BuildingRow extends BuildingRowRaw {
  scoringBreakdown: ScoringBreakdown;
  recurringIssueCount: number;
}

const DAYS_PER_YEAR = 365.25;

function withScoringBreakdown(row: BuildingRowRaw): BuildingRow {
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

export interface ZipSummary {
  totalViolations: number;
  totalBuildings: number;
  avgRating: number | null;
  worstBuilding: BuildingRow | null;
}

interface ZipTotalsRow {
  totalBuildings: string;
  totalViolations: string;
  avgRating: string | null;
}

// Covers US-1/US-2/US-3 (specs/001-zip-search-and-buildings-summary.md).
export async function getZipSummaryAndTopBuildings(
  pool: Pool,
  zip: string
): Promise<{ summary: ZipSummary; topBuildings: BuildingRow[] }> {
  const totalsResult = await pool.query<ZipTotalsRow>(
    'SELECT COUNT(*) as "totalBuildings", COALESCE(SUM(violation_count), 0) as "totalViolations", AVG(rating) as "avgRating" FROM buildings WHERE postcode = $1',
    [zip]
  );
  const totals = totalsResult.rows[0];

  const buildingsResult = await pool.query<BuildingRowRaw>(
    `SELECT building_id, street_name, postcode, house_number_display, latitude, longitude,
            violation_count, rent_impairing_count, avg_days_open,
            percent_dead_end, percent_reissued, recurring_issue_count,
            rating, last_violation_date
     FROM buildings WHERE postcode = $1 ORDER BY rating ASC, violation_count DESC LIMIT 10`,
    [zip]
  );

  const topBuildings = buildingsResult.rows.map(withScoringBreakdown);

  return {
    summary: {
      totalViolations: Number(totals.totalViolations),
      totalBuildings: Number(totals.totalBuildings),
      avgRating: totals.avgRating === null ? null : Number(totals.avgRating),
      worstBuilding: topBuildings[0] ?? null,
    },
    topBuildings,
  };
}

export interface ViolationRow {
  violation_id: string;
  house_number: string;
  street_name: string;
  inspection_date: string;
  current_status: string;
  violation_status: string;
  rent_impairing: 0 | 1;
  nov_description: string;
  nov_type: string;
  days_open: number;
}

// Covers US-4 (expand building to see violation details).
export async function getViolationsForBuilding(
  pool: Pool,
  buildingId: string
): Promise<ViolationRow[]> {
  const result = await pool.query<ViolationRow>(
    `SELECT violation_id, house_number, street_name, inspection_date, current_status,
            violation_status, rent_impairing, nov_description, nov_type, days_open
     FROM violations WHERE building_id = $1 ORDER BY house_number, inspection_date DESC`,
    [buildingId]
  );
  return result.rows;
}

interface MaxViolationsRow {
  maxViolations: string | null;
}

// specs/007-scoring-new-formulas.md: product-spec §4.2 Factor 1 needs the
// max violation_count among buildings in the same zip, computed fresh at
// query time (not hardcoded/cached) so a building's Factor-1 score reflects
// the current state of its zip. Called from loadIntoDb.ts (via a checked-out
// transaction client) at load time, per this project's load-time-not-
// read-time scoring architecture.
export async function getMaxViolationsInZip(db: Queryable, zip: string): Promise<number> {
  const result = await db.query<MaxViolationsRow>(
    'SELECT MAX(violation_count) as "maxViolations" FROM buildings WHERE postcode = $1',
    [zip]
  );
  const maxViolations = result.rows[0]?.maxViolations;
  return maxViolations === null || maxViolations === undefined ? 0 : Number(maxViolations);
}

export interface HeatmapPoint {
  building_id: string;
  latitude: number;
  longitude: number;
  weight: number;
  house_number_display: string;
  street_name: string;
}

interface HeatmapSourceRow {
  building_id: string;
  latitude: number;
  longitude: number;
  violation_count: number;
  house_number_display: string;
  street_name: string;
}

// Covers US-6. Weight is the building's violation_count, clamped so a single
// outlier building doesn't wash out the rest of the heatmap. Address fields
// are carried through so map markers can show what building a point is
// (spec: map popups show the address, not just a violation count).
export async function getHeatmapPoints(pool: Pool, zip: string): Promise<HeatmapPoint[]> {
  const result = await pool.query<HeatmapSourceRow>(
    'SELECT building_id, latitude, longitude, violation_count, house_number_display, street_name FROM buildings WHERE postcode = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL',
    [zip]
  );

  return result.rows.map((r) => ({
    building_id: r.building_id,
    latitude: r.latitude,
    longitude: r.longitude,
    weight: Math.min(r.violation_count, 100),
    house_number_display: r.house_number_display,
    street_name: r.street_name,
  }));
}
