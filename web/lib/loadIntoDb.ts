import type { Pool } from 'pg';
import { aggregateBuildings, type RawViolationRow } from './csvLoader';
import { calculateScore } from './scoring';

const UPSERT_BUILDING_SQL = `
  INSERT INTO buildings (
    building_id, bin, bbl, street_name, postcode,
    house_number_low, house_number_high, house_number_display,
    latitude, longitude, violation_count, rent_impairing_count,
    avg_days_open, percent_dead_end, percent_reissued, recurring_issue_count,
    rating, last_violation_date
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8,
    $9, $10, $11, $12,
    $13, $14, $15, $16,
    $17, $18
  )
  ON CONFLICT (building_id) DO UPDATE SET
    bin = excluded.bin,
    bbl = excluded.bbl,
    street_name = excluded.street_name,
    postcode = excluded.postcode,
    house_number_low = excluded.house_number_low,
    house_number_high = excluded.house_number_high,
    house_number_display = excluded.house_number_display,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    violation_count = excluded.violation_count,
    rent_impairing_count = excluded.rent_impairing_count,
    avg_days_open = excluded.avg_days_open,
    percent_dead_end = excluded.percent_dead_end,
    percent_reissued = excluded.percent_reissued,
    recurring_issue_count = excluded.recurring_issue_count,
    rating = excluded.rating,
    last_violation_date = excluded.last_violation_date
`;

const UPSERT_VIOLATION_SQL = `
  INSERT INTO violations (
    violation_id, building_id, postcode, house_number, street_name,
    inspection_date, current_status, violation_status, rent_impairing,
    nov_description, nov_type, days_open
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12
  )
  ON CONFLICT (violation_id) DO UPDATE SET
    current_status = excluded.current_status,
    violation_status = excluded.violation_status,
    days_open = excluded.days_open
`;

// Loads raw CSV rows into the Supabase Postgres database (schema created by
// db/migrations/001_init.sql — see scripts/migrate.ts). Idempotent: re-running
// with the same rows replaces prior data for those violation_ids/building_ids
// rather than duplicating.
//
// Postgres port of the former better-sqlite3 loader (see web/lib/db.ts,
// kept as a regression baseline through Phase 1-2 per the locked 2026-08-12
// decision — not yet removed). Runs the whole load as a single transaction
// held on one pooled connection (pool.connect() -> BEGIN -> ... -> COMMIT/
// ROLLBACK -> release()), per Supabase's transaction-mode pooler constraint:
// plain parameterized queries only, no persistent prepared-statement handles.
export async function loadIntoDb(
  pool: Pool,
  rows: RawViolationRow[],
  asOf: Date = new Date()
): Promise<{ buildingsLoaded: number; violationsLoaded: number }> {
  const { buildings, violations } = aggregateBuildings(rows, asOf);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const b of buildings) {
      const { score } = calculateScore({
        violationCount: b.violation_count,
        rentImpairingCount: b.rent_impairing_count,
        avgDaysOpen: b.avg_days_open,
        percentDeadEnd: b.percent_dead_end,
        percentReissued: b.percent_reissued,
      });

      await client.query(UPSERT_BUILDING_SQL, [
        b.building_id,
        b.bin,
        b.bbl,
        b.street_name,
        b.postcode,
        b.house_number_low,
        b.house_number_high,
        b.house_number_display,
        b.latitude,
        b.longitude,
        b.violation_count,
        b.rent_impairing_count,
        b.avg_days_open,
        b.percent_dead_end,
        b.percent_reissued,
        b.recurring_issue_count,
        score,
        b.last_violation_date,
      ]);
    }

    for (const v of violations) {
      await client.query(UPSERT_VIOLATION_SQL, [
        v.violation_id,
        v.building_id,
        v.postcode,
        v.house_number,
        v.street_name,
        v.inspection_date,
        v.current_status,
        v.violation_status,
        v.rent_impairing,
        v.nov_description,
        v.nov_type,
        v.days_open,
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { buildingsLoaded: buildings.length, violationsLoaded: violations.length };
}
