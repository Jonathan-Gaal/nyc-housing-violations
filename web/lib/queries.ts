import type Database from 'better-sqlite3';

export interface BuildingRow {
  building_id: string;
  street_name: string;
  postcode: string;
  house_number_display: string;
  latitude: number;
  longitude: number;
  violation_count: number;
  rent_impairing_count: number;
  avg_days_open: number;
  rating: number;
  last_violation_date: string;
}

export interface ZipSummary {
  totalViolations: number;
  totalBuildings: number;
  avgRating: number | null;
  worstBuilding: BuildingRow | null;
}

// Covers US-1/US-2/US-3 (specs/001-zip-search-and-buildings-summary.md).
export function getZipSummaryAndTopBuildings(
  db: Database.Database,
  zip: string
): { summary: ZipSummary; topBuildings: BuildingRow[] } {
  const totals = db
    .prepare(
      'SELECT COUNT(*) as totalBuildings, COALESCE(SUM(violation_count), 0) as totalViolations, AVG(rating) as avgRating FROM buildings WHERE postcode = ?'
    )
    .get(zip) as { totalBuildings: number; totalViolations: number; avgRating: number | null };

  const topBuildings = db
    .prepare(
      `SELECT building_id, street_name, postcode, house_number_display, latitude, longitude,
              violation_count, rent_impairing_count, avg_days_open, rating, last_violation_date
       FROM buildings WHERE postcode = ? ORDER BY rating ASC, violation_count DESC LIMIT 10`
    )
    .all(zip) as BuildingRow[];

  return {
    summary: {
      totalViolations: totals.totalViolations,
      totalBuildings: totals.totalBuildings,
      avgRating: totals.avgRating,
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
export function getViolationsForBuilding(
  db: Database.Database,
  buildingId: string
): ViolationRow[] {
  return db
    .prepare(
      `SELECT violation_id, house_number, street_name, inspection_date, current_status,
              violation_status, rent_impairing, nov_description, nov_type, days_open
       FROM violations WHERE building_id = ? ORDER BY house_number, inspection_date DESC`
    )
    .all(buildingId) as ViolationRow[];
}

export interface HeatmapPoint {
  building_id: string;
  latitude: number;
  longitude: number;
  weight: number;
}

// Covers US-6. Weight is the building's violation_count, clamped so a single
// outlier building doesn't wash out the rest of the heatmap.
export function getHeatmapPoints(db: Database.Database, zip: string): HeatmapPoint[] {
  const rows = db
    .prepare(
      'SELECT building_id, latitude, longitude, violation_count FROM buildings WHERE postcode = ? AND latitude IS NOT NULL AND longitude IS NOT NULL'
    )
    .all(zip) as { building_id: string; latitude: number; longitude: number; violation_count: number }[];

  return rows.map((r) => ({
    building_id: r.building_id,
    latitude: r.latitude,
    longitude: r.longitude,
    weight: Math.min(r.violation_count, 100),
  }));
}
