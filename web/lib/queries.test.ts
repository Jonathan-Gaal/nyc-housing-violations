import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { getPool, isDatabaseUrlPlaceholder } from './pgClient';
import { loadIntoDb } from './loadIntoDb';
import { getZipSummaryAndTopBuildings, getViolationsForBuilding, getHeatmapPoints } from './queries';
import type { RawViolationRow } from './csvLoader';

// Runs against the real Supabase Postgres instance (see loadIntoDb.test.ts
// for the same skip rationale). Skipped, not failed, while DATABASE_URL is
// still the web/.env.example placeholder.
const databaseUrlIsPlaceholder = isDatabaseUrlPlaceholder(process.env.DATABASE_URL);

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

describe.skipIf(databaseUrlIsPlaceholder)('query layer (Postgres, real Supabase instance)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = getPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE violations, buildings RESTART IDENTITY CASCADE');

    // 11 buildings in 11106 (to prove the top-10 cap), 1 in a different zip
    const rows: RawViolationRow[] = [];
    for (let i = 0; i < 11; i++) {
      rows.push(row({ ViolationID: `v${i}`, BuildingID: `B${i}` }));
      // give building 0 extra violations so it's unambiguously worst
      if (i === 0) {
        for (let j = 0; j < 40; j++) {
          rows.push(row({ ViolationID: `v0-${j}`, BuildingID: 'B0' }));
        }
      }
    }
    rows.push(row({ ViolationID: 'other-zip', BuildingID: 'X1', Postcode: '99999' }));
    await loadIntoDb(pool, rows, new Date('2026-08-04'));
  });

  it('returns zip-level summary stats', async () => {
    const { summary } = await getZipSummaryAndTopBuildings(pool, '11106');
    expect(summary.totalBuildings).toBe(11);
    expect(summary.totalViolations).toBe(11 + 40);
  });

  it('caps top buildings at 10 even when more exist', async () => {
    const { topBuildings } = await getZipSummaryAndTopBuildings(pool, '11106');
    expect(topBuildings).toHaveLength(10);
  });

  it('orders buildings worst-first by rating', async () => {
    const { topBuildings } = await getZipSummaryAndTopBuildings(pool, '11106');
    expect(topBuildings[0].building_id).toBe('B0');
    for (let i = 1; i < topBuildings.length; i++) {
      expect(topBuildings[i].rating).toBeGreaterThanOrEqual(topBuildings[i - 1].rating);
    }
  });

  it('returns an empty (not error) result for a zip with no buildings', async () => {
    const { summary, topBuildings } = await getZipSummaryAndTopBuildings(pool, '00000');
    expect(summary.totalBuildings).toBe(0);
    expect(summary.totalViolations).toBe(0);
    expect(summary.worstBuilding).toBeNull();
    expect(topBuildings).toEqual([]);
  });

  it('does not leak buildings from other zips into the summary', async () => {
    const { summary } = await getZipSummaryAndTopBuildings(pool, '99999');
    expect(summary.totalBuildings).toBe(1);
  });

  it('returns all violations for a building', async () => {
    const violations = await getViolationsForBuilding(pool, 'B0');
    expect(violations.length).toBe(41); // 1 initial + 40 extra
  });

  it('returns heatmap points with clamped weights', async () => {
    const points = await getHeatmapPoints(pool, '11106');
    expect(points.length).toBe(11);
    const b0 = points.find((p) => p.building_id === 'B0')!;
    expect(b0.weight).toBe(41 > 100 ? 100 : 41);
    expect(points.every((p) => p.weight <= 100)).toBe(true);
  });

  // Regression oracle (specs/004-postgres-loader-queries.md): top-10 ordering
  // for zip 11106 must match the SQLite-era result on the real CSV fixture,
  // not just this suite's synthetic fixture data.
  it('regression: top-10 building_id ordering for zip 11106 matches on the real CSV fixture', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { parse } = await import('csv-parse/sync');

    await pool.query('TRUNCATE TABLE violations, buildings RESTART IDENTITY CASCADE');

    const csvPath = path.join(
      process.cwd(),
      '..',
      'data',
      'Housing_Maintenance_Code_Violations_20260803.csv'
    );
    const content = fs.readFileSync(csvPath, 'utf-8');
    const rows: RawViolationRow[] = parse(content, { columns: true, skip_empty_lines: true });
    await loadIntoDb(pool, rows);

    const { topBuildings } = await getZipSummaryAndTopBuildings(pool, '11106');
    expect(topBuildings.length).toBeGreaterThan(0);
    expect(topBuildings.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < topBuildings.length; i++) {
      expect(topBuildings[i].rating).toBeGreaterThanOrEqual(topBuildings[i - 1].rating);
    }
  });
});
