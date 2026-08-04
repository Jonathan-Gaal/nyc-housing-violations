import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { initSchema } from './db';
import { loadIntoDb } from './loadIntoDb';
import type { RawViolationRow } from './csvLoader';
import type { BuildingRecord } from './csvLoader';

interface CountRow {
  n: number;
}

function row(overrides: Partial<RawViolationRow>): RawViolationRow {
  return {
    ViolationID: '1',
    BuildingID: 'B1',
    Postcode: '11106',
    HouseNumber: '14-31',
    LowHouseNumber: '14-31',
    HighHouseNumber: '14-31',
    StreetName: '31 ROAD',
    InspectionDate: '2026-07-01',
    CurrentStatus: 'NOT COMPLIED WITH',
    ViolationStatus: 'Open',
    RentImpairing: 'N',
    NOVDescription: 'Heat inadequate',
    NovType: 'HEAT',
    Latitude: '40.7614',
    Longitude: '-73.9776',
    BIN: 'BIN1',
    BBL: 'BBL1',
    ...overrides,
  };
}

describe('loadIntoDb', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });

  it('loads buildings and violations with a computed rating', () => {
    const rows = [
      row({ ViolationID: '1', RentImpairing: 'Y' }),
      row({ ViolationID: '2', RentImpairing: 'N' }),
    ];
    const result = loadIntoDb(db, rows, new Date('2026-08-04'));
    expect(result).toEqual({ buildingsLoaded: 1, violationsLoaded: 2 });

    const building = db
      .prepare('SELECT * FROM buildings WHERE building_id = ?')
      .get('B1') as BuildingRecord & { rating: number };
    expect(building.violation_count).toBe(2);
    expect(building.rent_impairing_count).toBe(1);
    expect(building.rating).toBeGreaterThan(0);
    expect(building.rating).toBeLessThanOrEqual(5);
    expect(building.house_number_low).toBe('14-31');

    const violationCount = db.prepare('SELECT COUNT(*) as n FROM violations').get() as CountRow;
    expect(violationCount.n).toBe(2);
  });

  it('is idempotent — reloading the same rows does not duplicate', () => {
    const rows = [row({ ViolationID: '1' }), row({ ViolationID: '2', BuildingID: 'B2' })];
    loadIntoDb(db, rows);
    loadIntoDb(db, rows);

    const buildings = db.prepare('SELECT COUNT(*) as n FROM buildings').get() as CountRow;
    const violations = db.prepare('SELECT COUNT(*) as n FROM violations').get() as CountRow;
    expect(buildings.n).toBe(2);
    expect(violations.n).toBe(2);
  });

  it('filters correctly by postcode (multi-zip data does not bleed together)', () => {
    const rows = [
      row({ ViolationID: '1', BuildingID: 'A', Postcode: '11106' }),
      row({ ViolationID: '2', BuildingID: 'B', Postcode: '11429' }),
    ];
    loadIntoDb(db, rows);

    const zip11106 = db
      .prepare('SELECT COUNT(*) as n FROM buildings WHERE postcode = ?')
      .get('11106') as CountRow;
    expect(zip11106.n).toBe(1);
  });
});
