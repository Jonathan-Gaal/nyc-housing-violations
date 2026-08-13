import type { Pool } from 'pg';
import { aggregateBuildings, type RawViolationRow } from './csvLoader';
import { calculateScore } from './scoring';
import { getMaxViolationsInZip } from './queries';

// Batched as a single UNNEST-based upsert rather than one query per row:
// param count is fixed at one array per column regardless of how many rows
// are loaded, so this stays a single round-trip whether it's 1 building or
// 10,000 — versus the former per-row loop, where loading a zip live from
// Socrata could mean thousands of sequential network round-trips to
// Supabase before the search response came back.
const UPSERT_BUILDINGS_SQL = `
  INSERT INTO buildings (
    building_id, bin, bbl, street_name, postcode,
    house_number_low, house_number_high, house_number_display,
    latitude, longitude, violation_count, rent_impairing_count,
    avg_days_open, percent_dead_end, percent_reissued, recurring_issue_count,
    rating, last_violation_date
  )
  SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
    $6::text[], $7::text[], $8::text[],
    $9::double precision[], $10::double precision[], $11::integer[], $12::integer[],
    $13::integer[], $14::double precision[], $15::double precision[], $16::integer[],
    $17::double precision[], $18::text[]
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

const UPSERT_VIOLATIONS_SQL = `
  INSERT INTO violations (
    violation_id, building_id, postcode, house_number, street_name,
    inspection_date, current_status, violation_status, rent_impairing,
    nov_description, nov_type, days_open
  )
  SELECT * FROM UNNEST(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
    $6::text[], $7::text[], $8::text[], $9::integer[],
    $10::text[], $11::text[], $12::integer[]
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
  const { buildings, violations: rawViolations } = aggregateBuildings(rows, asOf);

  // Unlike `buildings` (already deduplicated by aggregateBuildings' Map-based
  // grouping), `violations` has one entry per input row. A single UNNEST
  // batch can't hit the same ON CONFLICT target twice — Postgres errors with
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" — so any
  // duplicate violation_id within this batch (e.g. Socrata page overlap) is
  // collapsed here, keeping the last occurrence to match the old per-row
  // loop's last-write-wins behavior.
  const violationsById = new Map<string, (typeof rawViolations)[number]>();
  for (const v of rawViolations) {
    violationsById.set(v.violation_id, v);
  }
  const violations = Array.from(violationsById.values());

  // specs/007-scoring-new-formulas.md: product-spec §4.2 Factor 1 needs
  // maxViolationsInZip. In-memory max covers buildings arriving in THIS
  // batch (the common case: a full zip's worth of rows loaded together);
  // the DB query covers buildings already persisted from a prior load that
  // aren't part of this batch. Taking the max of both keeps Factor 1
  // correct regardless of whether a zip is loaded in one batch or several,
  // without recomputing the zip max once per building.
  const inMemoryMaxByZip = new Map<string, number>();
  for (const b of buildings) {
    const currentMax = inMemoryMaxByZip.get(b.postcode) ?? 0;
    if (b.violation_count > currentMax) {
      inMemoryMaxByZip.set(b.postcode, b.violation_count);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const maxViolationsInZipByZip = new Map<string, number>();
    for (const zip of new Set(buildings.map((b) => b.postcode))) {
      const persistedMax = await getMaxViolationsInZip(client, zip);
      const inMemoryMax = inMemoryMaxByZip.get(zip) ?? 0;
      maxViolationsInZipByZip.set(zip, Math.max(persistedMax, inMemoryMax));
    }

    if (buildings.length > 0) {
      const scores = buildings.map(
        (b) =>
          calculateScore({
            violationCount: b.violation_count,
            rentImpairingCount: b.rent_impairing_count,
            avgDaysOpen: b.avg_days_open,
            percentDeadEnd: b.percent_dead_end,
            percentReissued: b.percent_reissued,
            maxViolationsInZip: maxViolationsInZipByZip.get(b.postcode) ?? b.violation_count,
          }).score
      );

      await client.query(UPSERT_BUILDINGS_SQL, [
        buildings.map((b) => b.building_id),
        buildings.map((b) => b.bin),
        buildings.map((b) => b.bbl),
        buildings.map((b) => b.street_name),
        buildings.map((b) => b.postcode),
        buildings.map((b) => b.house_number_low),
        buildings.map((b) => b.house_number_high),
        buildings.map((b) => b.house_number_display),
        buildings.map((b) => b.latitude),
        buildings.map((b) => b.longitude),
        buildings.map((b) => b.violation_count),
        buildings.map((b) => b.rent_impairing_count),
        buildings.map((b) => b.avg_days_open),
        buildings.map((b) => b.percent_dead_end),
        buildings.map((b) => b.percent_reissued),
        buildings.map((b) => b.recurring_issue_count),
        scores,
        buildings.map((b) => b.last_violation_date),
      ]);
    }

    if (violations.length > 0) {
      await client.query(UPSERT_VIOLATIONS_SQL, [
        violations.map((v) => v.violation_id),
        violations.map((v) => v.building_id),
        violations.map((v) => v.postcode),
        violations.map((v) => v.house_number),
        violations.map((v) => v.street_name),
        violations.map((v) => v.inspection_date),
        violations.map((v) => v.current_status),
        violations.map((v) => v.violation_status),
        violations.map((v) => v.rent_impairing),
        violations.map((v) => v.nov_description),
        violations.map((v) => v.nov_type),
        violations.map((v) => v.days_open),
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
