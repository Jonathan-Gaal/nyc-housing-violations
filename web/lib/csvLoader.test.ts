import { describe, expect, it } from 'vitest';
import { aggregateBuildings, type RawViolationRow } from './csvLoader';

const ASOF = new Date('2026-08-04T00:00:00Z');

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

describe('aggregateBuildings', () => {
  it('regression: block-lot house numbers are never numerically parsed', () => {
    // "14-31" through parseInt() becomes 14 — this test fails if that bug returns.
    const { buildings } = aggregateBuildings([
      row({ LowHouseNumber: '14-31', HighHouseNumber: '14-33' }),
    ]);
    expect(buildings[0].house_number_low).toBe('14-31');
    expect(buildings[0].house_number_high).toBe('14-33');
    expect(typeof buildings[0].house_number_low).toBe('string');
  });

  it('formats a single-address building without a range', () => {
    const { buildings } = aggregateBuildings([
      row({ LowHouseNumber: '36-63', HighHouseNumber: '36-63' }),
    ]);
    expect(buildings[0].house_number_display).toBe('36-63');
  });

  it('formats a multi-entrance building with a "low to high" range', () => {
    const { buildings } = aggregateBuildings([
      row({ LowHouseNumber: '14-31', HighHouseNumber: '14-33' }),
    ]);
    expect(buildings[0].house_number_display).toBe('14-31 to 14-33');
  });

  it('aggregates all violations for a building across different entrance house numbers', () => {
    const rows = [
      row({ ViolationID: '1', HouseNumber: '14-31', RentImpairing: 'Y' }),
      row({ ViolationID: '2', HouseNumber: '14-32', RentImpairing: 'N' }),
      row({ ViolationID: '3', HouseNumber: '14-33', RentImpairing: 'Y' }),
    ];
    const { buildings, violations } = aggregateBuildings(rows);
    expect(buildings).toHaveLength(1);
    expect(buildings[0].violation_count).toBe(3);
    expect(buildings[0].rent_impairing_count).toBe(2);
    expect(violations).toHaveLength(3);
  });

  it('keeps separate buildings separate', () => {
    const rows = [
      row({ ViolationID: '1', BuildingID: 'A' }),
      row({ ViolationID: '2', BuildingID: 'B' }),
    ];
    const { buildings } = aggregateBuildings(rows);
    expect(buildings.map((b) => b.building_id).sort()).toEqual(['A', 'B']);
  });

  it('computes avg_days_open relative to the given asOf date', () => {
    const rows = [
      row({ ViolationID: '1', InspectionDate: '2026-07-04' }), // 31 days before ASOF
      row({ ViolationID: '2', InspectionDate: '2026-07-14' }), // 21 days before ASOF
    ];
    const { buildings } = aggregateBuildings(rows, ASOF);
    expect(buildings[0].avg_days_open).toBe(26); // (31 + 21) / 2
  });

  it('tracks the most recent violation date per building', () => {
    const rows = [
      row({ ViolationID: '1', InspectionDate: '2026-01-01' }),
      row({ ViolationID: '2', InspectionDate: '2026-07-01' }),
    ];
    const { buildings } = aggregateBuildings(rows);
    expect(buildings[0].last_violation_date).toBe('2026-07-01');
  });

  it('parses RentImpairing Y/N into 1/0', () => {
    const { violations } = aggregateBuildings([row({ RentImpairing: 'Y' })]);
    expect(violations[0].rent_impairing).toBe(1);
  });
});
