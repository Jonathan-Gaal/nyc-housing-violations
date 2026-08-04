import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { initSchema } from './db';
import { loadIntoDb } from './loadIntoDb';
import { getZipSummaryAndTopBuildings, getViolationsForBuilding, getHeatmapPoints } from './queries';
import type { RawViolationRow } from './csvLoader';

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

describe('query layer', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    // 11 buildings in 11106 (to prove the top-10 cap), 1 in a different zip
    const rows: RawViolationRow[] = [];
    for (let i = 0; i < 11; i++) {
      rows.push(
        row({
          ViolationID: `v${i}`,
          BuildingID: `B${i}`,
          // more violations = worse rating, descending so B0 is worst
          ...(i === 0 ? {} : {}),
        })
      );
      // give building 0 extra violations so it's unambiguously worst
      if (i === 0) {
        for (let j = 0; j < 40; j++) {
          rows.push(row({ ViolationID: `v0-${j}`, BuildingID: 'B0' }));
        }
      }
    }
    rows.push(row({ ViolationID: 'other-zip', BuildingID: 'X1', Postcode: '99999' }));
    loadIntoDb(db, rows, new Date('2026-08-04'));
  });

  it('returns zip-level summary stats', () => {
    const { summary } = getZipSummaryAndTopBuildings(db, '11106');
    expect(summary.totalBuildings).toBe(11);
    expect(summary.totalViolations).toBe(11 + 40);
  });

  it('caps top buildings at 10 even when more exist', () => {
    const { topBuildings } = getZipSummaryAndTopBuildings(db, '11106');
    expect(topBuildings).toHaveLength(10);
  });

  it('orders buildings worst-first by rating', () => {
    const { topBuildings } = getZipSummaryAndTopBuildings(db, '11106');
    expect(topBuildings[0].building_id).toBe('B0');
    for (let i = 1; i < topBuildings.length; i++) {
      expect(topBuildings[i].rating).toBeGreaterThanOrEqual(topBuildings[i - 1].rating);
    }
  });

  it('returns an empty (not error) result for a zip with no buildings', () => {
    const { summary, topBuildings } = getZipSummaryAndTopBuildings(db, '00000');
    expect(summary.totalBuildings).toBe(0);
    expect(summary.totalViolations).toBe(0);
    expect(summary.worstBuilding).toBeNull();
    expect(topBuildings).toEqual([]);
  });

  it('does not leak buildings from other zips into the summary', () => {
    const { summary } = getZipSummaryAndTopBuildings(db, '99999');
    expect(summary.totalBuildings).toBe(1);
  });

  it('returns all violations for a building', () => {
    const violations = getViolationsForBuilding(db, 'B0');
    expect(violations.length).toBe(41); // 1 initial + 40 extra
  });

  it('returns heatmap points with clamped weights', () => {
    const points = getHeatmapPoints(db, '11106');
    expect(points.length).toBe(11);
    const b0 = points.find((p) => p.building_id === 'B0')!;
    expect(b0.weight).toBe(41 > 100 ? 100 : 41);
    expect(points.every((p) => p.weight <= 100)).toBe(true);
  });
});
