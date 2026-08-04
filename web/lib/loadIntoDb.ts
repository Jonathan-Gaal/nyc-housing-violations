import type Database from 'better-sqlite3';
import { aggregateBuildings, type RawViolationRow } from './csvLoader';
import { calculateRating } from './rating';

// Loads raw CSV rows into an already-initialized SQLite database (see db.ts
// initSchema). Idempotent: re-running with the same rows replaces prior data
// for those violation_ids/building_ids rather than duplicating.
export function loadIntoDb(db: Database.Database, rows: RawViolationRow[], asOf = new Date()): {
  buildingsLoaded: number;
  violationsLoaded: number;
} {
  const { buildings, violations } = aggregateBuildings(rows, asOf);

  const insertBuilding = db.prepare(`
    INSERT INTO buildings (
      building_id, bin, bbl, street_name, postcode,
      house_number_low, house_number_high, house_number_display,
      latitude, longitude, violation_count, rent_impairing_count,
      avg_days_open, rating, last_violation_date
    ) VALUES (
      @building_id, @bin, @bbl, @street_name, @postcode,
      @house_number_low, @house_number_high, @house_number_display,
      @latitude, @longitude, @violation_count, @rent_impairing_count,
      @avg_days_open, @rating, @last_violation_date
    )
    ON CONFLICT(building_id) DO UPDATE SET
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
      rating = excluded.rating,
      last_violation_date = excluded.last_violation_date
  `);

  const insertViolation = db.prepare(`
    INSERT INTO violations (
      violation_id, building_id, postcode, house_number, street_name,
      inspection_date, current_status, violation_status, rent_impairing,
      nov_description, nov_type, days_open
    ) VALUES (
      @violation_id, @building_id, @postcode, @house_number, @street_name,
      @inspection_date, @current_status, @violation_status, @rent_impairing,
      @nov_description, @nov_type, @days_open
    )
    ON CONFLICT(violation_id) DO UPDATE SET
      current_status = excluded.current_status,
      violation_status = excluded.violation_status,
      days_open = excluded.days_open
  `);

  const runAll = db.transaction(() => {
    for (const b of buildings) {
      const rating = calculateRating({
        violationCount: b.violation_count,
        avgDaysOpen: b.avg_days_open,
        rentImpairingCount: b.rent_impairing_count,
      });
      insertBuilding.run({ ...b, rating });
    }
    for (const v of violations) {
      insertViolation.run(v);
    }
  });
  runAll();

  return { buildingsLoaded: buildings.length, violationsLoaded: violations.length };
}
