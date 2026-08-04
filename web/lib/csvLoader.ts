// Aggregates raw HPD violation rows into buildings + violations records.
//
// IMPORTANT: LowHouseNumber/HighHouseNumber are NYC block-lot text ("14-31"),
// not integers. A prior version of this loader used `parseInt(row.HouseNumber)`,
// which truncates "14-31" to 14 and silently corrupts every multi-entrance
// address range. Verified against the real CSV (../context/data-context/
// CSV_VERIFICATION_REPORT.md, VERIFICATION_HIGH_LOW_LOGIC.md): treat these
// fields as opaque strings end-to-end, never numbers.

export interface RawViolationRow {
  ViolationID: string;
  BuildingID: string;
  Postcode: string;
  HouseNumber: string;
  LowHouseNumber: string;
  HighHouseNumber: string;
  StreetName: string;
  InspectionDate: string;
  CurrentStatus: string;
  ViolationStatus: string;
  RentImpairing: string;
  NOVDescription: string;
  NovType: string;
  Latitude: string;
  Longitude: string;
  BIN: string;
  BBL: string;
}

export interface ViolationRecord {
  violation_id: string;
  building_id: string;
  postcode: string;
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

export interface BuildingRecord {
  building_id: string;
  bin: string;
  bbl: string;
  street_name: string;
  postcode: string;
  house_number_low: string;
  house_number_high: string;
  house_number_display: string;
  latitude: number;
  longitude: number;
  violation_count: number;
  rent_impairing_count: number;
  avg_days_open: number;
  last_violation_date: string;
}

function daysBetween(dateStr: string, asOf: Date): number {
  const d = new Date(dateStr);
  const ms = asOf.getTime() - d.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function houseNumberDisplay(low: string, high: string): string {
  return low === high ? low : `${low} to ${high}`;
}

export function aggregateBuildings(
  rows: RawViolationRow[],
  asOf: Date = new Date()
): { buildings: BuildingRecord[]; violations: ViolationRecord[] } {
  const violations: ViolationRecord[] = [];
  const byBuilding = new Map<
    string,
    {
      bin: string;
      bbl: string;
      street_name: string;
      postcode: string;
      house_number_low: string;
      house_number_high: string;
      latitude: number;
      longitude: number;
      violation_count: number;
      rent_impairing_count: number;
      days_open_sum: number;
      last_violation_date: string;
    }
  >();

  for (const row of rows) {
    const rentImpairing = row.RentImpairing === 'Y' ? 1 : 0;
    const daysOpen = daysBetween(row.InspectionDate, asOf);

    violations.push({
      violation_id: row.ViolationID,
      building_id: row.BuildingID,
      postcode: row.Postcode,
      house_number: row.HouseNumber,
      street_name: row.StreetName,
      inspection_date: row.InspectionDate,
      current_status: row.CurrentStatus,
      violation_status: row.ViolationStatus,
      rent_impairing: rentImpairing,
      nov_description: row.NOVDescription,
      nov_type: row.NovType,
      days_open: daysOpen,
    });

    const existing = byBuilding.get(row.BuildingID);
    if (!existing) {
      byBuilding.set(row.BuildingID, {
        bin: row.BIN,
        bbl: row.BBL,
        street_name: row.StreetName,
        postcode: row.Postcode,
        house_number_low: row.LowHouseNumber,
        house_number_high: row.HighHouseNumber,
        latitude: parseFloat(row.Latitude),
        longitude: parseFloat(row.Longitude),
        violation_count: 1,
        rent_impairing_count: rentImpairing,
        days_open_sum: daysOpen,
        last_violation_date: row.InspectionDate,
      });
    } else {
      existing.violation_count += 1;
      existing.rent_impairing_count += rentImpairing;
      existing.days_open_sum += daysOpen;
      if (row.InspectionDate > existing.last_violation_date) {
        existing.last_violation_date = row.InspectionDate;
      }
    }
  }

  const buildings: BuildingRecord[] = Array.from(byBuilding.entries()).map(
    ([building_id, b]) => ({
      building_id,
      bin: b.bin,
      bbl: b.bbl,
      street_name: b.street_name,
      postcode: b.postcode,
      house_number_low: b.house_number_low,
      house_number_high: b.house_number_high,
      house_number_display: houseNumberDisplay(b.house_number_low, b.house_number_high),
      latitude: b.latitude,
      longitude: b.longitude,
      violation_count: b.violation_count,
      rent_impairing_count: b.rent_impairing_count,
      avg_days_open: Math.round(b.days_open_sum / b.violation_count),
      last_violation_date: b.last_violation_date,
    })
  );

  return { buildings, violations };
}
