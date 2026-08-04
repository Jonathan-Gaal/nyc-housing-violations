import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'violations.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS buildings (
      building_id TEXT PRIMARY KEY,
      bin TEXT,
      bbl TEXT,
      street_name TEXT NOT NULL,
      postcode TEXT NOT NULL,
      house_number_low TEXT NOT NULL,
      house_number_high TEXT NOT NULL,
      house_number_display TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      violation_count INTEGER NOT NULL DEFAULT 0,
      rent_impairing_count INTEGER NOT NULL DEFAULT 0,
      avg_days_open INTEGER NOT NULL DEFAULT 0,
      rating REAL NOT NULL DEFAULT 0,
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
  `);
}
