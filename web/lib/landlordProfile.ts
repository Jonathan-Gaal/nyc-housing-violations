// Landlord portfolio profiles: cross-references a building's officer (the
// real person behind an LLC — lib/landlords.ts) against every other HPD
// registration that same officer + business address is attached to
// citywide, then aggregates violations across all those buildings into a
// portfolio-level score. See db/migrations/005_add_landlord_profiles.sql
// and specs-style rationale below.
//
// Matching is name + business address, not a stable ID — HPD's data has no
// such thing. Verified against real data (GRIGORIY KANDKHOROV, 124 Audley
// Street, Richmond Hill): the same officer appears across 5 registrations
// with inconsistent capitalization ("KANDKHOROV" vs "Kandkhorov"), and a
// same-address relative (VYACHESLAV KANDKHOROV) is a genuinely different
// person — so this is always "buildings *likely* under this owner," not a
// legal fact. Case-insensitive exact match on name + normalized address is
// the deliberate middle ground between under- and over-matching.
import type { Pool } from 'pg';
import { fetchJsonArrayWithRetry } from './socrata';

const CONTACTS_DATASET_ID = 'feu5-w2e2';
const CONTACTS_URL = `https://data.cityofnewyork.us/resource/${CONTACTS_DATASET_ID}.json`;
const REGISTRATIONS_DATASET_ID = 'tesw-yqqr';
const REGISTRATIONS_URL = `https://data.cityofnewyork.us/resource/${REGISTRATIONS_DATASET_ID}.json`;
const VIOLATIONS_DATASET_ID = 'wvxf-dwi5';
const VIOLATIONS_URL = `https://data.cityofnewyork.us/resource/${VIOLATIONS_DATASET_ID}.json`;

// A portfolio-scale violations-per-building cap for the scoring formula
// below — chosen from this session's observed building-level data (a
// severely neglected single building often has 100-200+ violations; a
// portfolio averaging that many per building across multiple properties is
// about as bad as this scale needs to distinguish).
const VIOLATIONS_PER_BUILDING_CAP = 50;
const AVG_YEARS_OPEN_CAP = 8; // same cap lib/scoring.ts uses for buildings
const DAYS_PER_YEAR = 365.25;

interface RegistrationContactMatch {
  registrationid: string;
  businesshousenumber?: string;
  businessstreetname?: string;
  businesscity?: string;
  businessstate?: string;
  businesszip?: string;
}

// Rebuilds the same combined-address string lib/landlords.ts's
// businessAddress() produces, so a match here can be compared directly
// against the caller's already-formatted businessAddress.
function combinedAddress(c: RegistrationContactMatch): string {
  const street = [c.businesshousenumber, c.businessstreetname].filter(Boolean).join(' ').trim();
  const cityState = [c.businesscity, c.businessstate].filter(Boolean).join(', ');
  return [street, cityState, c.businesszip].filter((part) => part && part.length > 0).join(', ');
}

interface RegistrationRow {
  registrationid: string;
  buildingid: string;
  housenumber?: string;
  streetname?: string;
  zip?: string;
}

interface ViolationAggregateRow {
  buildingid: string;
  inspectiondate: string;
  rentimpairing: string;
}

export interface LandlordProfile {
  landlordKey: string;
  officerName: string;
  businessAddress: string | null;
  buildingCount: number;
  totalViolationCount: number;
  totalRentImpairingCount: number;
  avgYearsOpen: number;
  rawScore: number;
  rating: number;
  buildingIds: string[];
  buildingAddresses: string[];
}

// Normalized composite key: HPD has no stable per-person ID, so this is the
// best available cache/identity key. Lowercased + whitespace-collapsed to
// absorb the exact "KANDKHOROV" vs "Kandkhorov" case variance seen in real
// data without introducing fuzzy matching.
export function normalizeLandlordKey(officerName: string, businessAddress: string | null): string {
  const name = officerName.trim().toLowerCase().replace(/\s+/g, ' ');
  const addr = (businessAddress ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${name}|${addr}`;
}

function calculateLandlordRawScore(input: {
  buildingCount: number;
  totalViolationCount: number;
  totalRentImpairingCount: number;
  avgYearsOpen: number;
}): number {
  const violationsPerBuilding = input.totalViolationCount / Math.max(1, input.buildingCount);
  // 40%: portfolio-wide violation density.
  const component1 = Math.min(violationsPerBuilding / VIOLATIONS_PER_BUILDING_CAP, 1) * 100;
  // 30%: what fraction of those violations are the most severe (rent-impairing) class.
  const component2 =
    input.totalViolationCount > 0
      ? (input.totalRentImpairingCount / input.totalViolationCount) * 100
      : 0;
  // 30%: how long violations persist on average, same cap/shape as building scoring.
  const component3 = Math.min(input.avgYearsOpen / AVG_YEARS_OPEN_CAP, 1) * 100;

  const weightedBadness = component1 * 0.4 + component2 * 0.3 + component3 * 0.3;
  return Math.round(Math.max(0, Math.min(100, 100 - weightedBadness)) * 10) / 10;
}

// Step 1: every registration_id this officer + business address is
// attached to, citywide (not limited to zips we've already seeded). Name
// matching happens in the SoQL query (cheap, narrows the result set);
// business address matching happens client-side afterward, since feu5-w2e2
// only has it split across 5 separate fields, not the single combined
// string this app compares against — see combinedAddress() above.
async function findRegistrationIdsForOfficer(
  firstName: string,
  lastName: string,
  businessAddress: string | null
): Promise<string[]> {
  const where = `upper(firstname)=upper('${firstName.replace(/'/g, "''")}') AND upper(lastname)=upper('${lastName.replace(/'/g, "''")}') AND type='HeadOfficer'`;
  const url = `${CONTACTS_URL}?$where=${encodeURIComponent(where)}&$limit=500`;
  const matches = await fetchJsonArrayWithRetry<RegistrationContactMatch>(url);

  const normalizedTarget = (businessAddress ?? '').trim().toLowerCase();
  const filtered = businessAddress
    ? matches.filter((m) => combinedAddress(m).trim().toLowerCase() === normalizedTarget)
    : matches;

  return Array.from(new Set(filtered.map((m) => m.registrationid)));
}

// Step 2: those registration_ids -> the buildings they're actually for.
async function findBuildingsForRegistrations(
  registrationIds: string[]
): Promise<{ buildingId: string; address: string }[]> {
  if (registrationIds.length === 0) return [];
  const idList = registrationIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  const url = `${REGISTRATIONS_URL}?$where=registrationid in(${idList})&$limit=500`;
  const rows = await fetchJsonArrayWithRetry<RegistrationRow>(url);

  const byBuilding = new Map<string, string>();
  for (const r of rows) {
    if (!r.buildingid) continue;
    const address = [r.housenumber, r.streetname, r.zip].filter(Boolean).join(' ');
    byBuilding.set(r.buildingid, address);
  }
  return Array.from(byBuilding.entries()).map(([buildingId, address]) => ({ buildingId, address }));
}

// Step 3: aggregate open-violation stats across those buildings, live from
// the source dataset — mirrors csvLoader.ts's daysBetween/rent-impairing
// counting, just scoped to a building-ID list instead of a zip.
async function aggregateViolationsForBuildings(
  buildingIds: string[]
): Promise<{ totalViolationCount: number; totalRentImpairingCount: number; avgYearsOpen: number }> {
  if (buildingIds.length === 0) {
    return { totalViolationCount: 0, totalRentImpairingCount: 0, avgYearsOpen: 0 };
  }
  const idList = buildingIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  const where = `buildingid in(${idList}) AND upper(violationstatus) like '%OPEN%'`;
  const url = `${VIOLATIONS_URL}?$where=${encodeURIComponent(where)}&$select=buildingid,inspectiondate,rentimpairing&$limit=5000`;
  const rows = await fetchJsonArrayWithRetry<ViolationAggregateRow>(url);

  const now = Date.now();
  let rentImpairingCount = 0;
  let daysSum = 0;
  for (const v of rows) {
    if (v.rentimpairing === 'Y') rentImpairingCount += 1;
    const days = Math.max(0, Math.round((now - new Date(v.inspectiondate).getTime()) / 86_400_000));
    daysSum += days;
  }

  return {
    totalViolationCount: rows.length,
    totalRentImpairingCount: rentImpairingCount,
    avgYearsOpen: rows.length > 0 ? daysSum / rows.length / DAYS_PER_YEAR : 0,
  };
}

async function fetchLandlordProfile(
  officerFirstName: string,
  officerLastName: string,
  officerName: string,
  businessAddress: string | null
): Promise<LandlordProfile> {
  const registrationIds = await findRegistrationIdsForOfficer(
    officerFirstName,
    officerLastName,
    businessAddress
  );
  const buildings = await findBuildingsForRegistrations(registrationIds);
  const { totalViolationCount, totalRentImpairingCount, avgYearsOpen } =
    await aggregateViolationsForBuildings(buildings.map((b) => b.buildingId));

  const rawScore = calculateLandlordRawScore({
    buildingCount: buildings.length,
    totalViolationCount,
    totalRentImpairingCount,
    avgYearsOpen,
  });

  return {
    landlordKey: normalizeLandlordKey(officerName, businessAddress),
    officerName,
    businessAddress,
    buildingCount: buildings.length,
    totalViolationCount,
    totalRentImpairingCount,
    avgYearsOpen: Math.round(avgYearsOpen * 10) / 10,
    rawScore,
    rating: rawScore, // provisional until recomputeLandlordPercentiles runs — see loadIntoDb.ts's same pattern for buildings
    buildingIds: buildings.map((b) => b.buildingId),
    buildingAddresses: buildings.map((b) => b.address),
  };
}

function rowToProfile(row: {
  landlord_key: string;
  officer_name: string;
  business_address: string | null;
  building_count: number;
  total_violation_count: number;
  total_rent_impairing_count: number;
  avg_years_open: string;
  raw_score: string;
  rating: string;
  building_ids: string[];
  building_addresses: string[];
}): LandlordProfile {
  return {
    landlordKey: row.landlord_key,
    officerName: row.officer_name,
    businessAddress: row.business_address,
    buildingCount: row.building_count,
    totalViolationCount: row.total_violation_count,
    totalRentImpairingCount: row.total_rent_impairing_count,
    avgYearsOpen: Number(row.avg_years_open),
    rawScore: Number(row.raw_score),
    rating: Number(row.rating),
    buildingIds: row.building_ids,
    buildingAddresses: row.building_addresses,
  };
}

// Cache-then-fetch (same pattern as lib/socrata.ts/lib/landlords.ts), plus
// a percentile recompute across every cached landlord after a genuinely new
// profile is added — there's no landlord-specific cron, so this keeps
// `rating` meaningful immediately rather than waiting on one. Mirrors
// lib/scoring.ts's recomputeCityWidePercentiles, just against a much
// smaller (and slower-growing) population.
export async function getOrFetchLandlordProfile(
  pool: Pool,
  officerFirstName: string,
  officerLastName: string,
  officerName: string,
  businessAddress: string | null
): Promise<LandlordProfile> {
  const key = normalizeLandlordKey(officerName, businessAddress);

  const cached = await pool.query(
    `SELECT landlord_key, officer_name, business_address, building_count, total_violation_count,
            total_rent_impairing_count, avg_years_open, raw_score, rating, building_ids, building_addresses
     FROM landlord_profiles WHERE landlord_key = $1`,
    [key]
  );
  if (cached.rows.length > 0) {
    return rowToProfile(cached.rows[0]);
  }

  const profile = await fetchLandlordProfile(
    officerFirstName,
    officerLastName,
    officerName,
    businessAddress
  );

  await pool.query(
    `INSERT INTO landlord_profiles (
       landlord_key, officer_name, business_address, building_count, total_violation_count,
       total_rent_impairing_count, avg_years_open, raw_score, rating, building_ids, building_addresses
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (landlord_key) DO UPDATE SET
       building_count = excluded.building_count,
       total_violation_count = excluded.total_violation_count,
       total_rent_impairing_count = excluded.total_rent_impairing_count,
       avg_years_open = excluded.avg_years_open,
       raw_score = excluded.raw_score,
       rating = excluded.rating,
       building_ids = excluded.building_ids,
       building_addresses = excluded.building_addresses,
       fetched_at = NOW()`,
    [
      profile.landlordKey,
      profile.officerName,
      profile.businessAddress,
      profile.buildingCount,
      profile.totalViolationCount,
      profile.totalRentImpairingCount,
      profile.avgYearsOpen,
      profile.rawScore,
      profile.rating,
      profile.buildingIds,
      profile.buildingAddresses,
    ]
  );

  await recomputeLandlordPercentiles(pool);

  // Re-read: recomputeLandlordPercentiles just overwrote `rating` for every
  // cached landlord, including the row inserted above.
  const refreshed = await pool.query(
    `SELECT landlord_key, officer_name, business_address, building_count, total_violation_count,
            total_rent_impairing_count, avg_years_open, raw_score, rating, building_ids, building_addresses
     FROM landlord_profiles WHERE landlord_key = $1`,
    [key]
  );
  return rowToProfile(refreshed.rows[0]);
}

// Unlike buildings (thousands of rows from the first zip load),
// landlord_profiles grows one lookup at a time — PERCENT_RANK() over a
// population of 1 always returns exactly 0, which would misleadingly show
// the very first landlord ever looked up as "the worst," not "the only
// one we've seen." Percentile ranking only kicks in once there's a real
// population to compare against; below that, `rating` stays raw_score
// (already the value it's set to at insert time).
const MIN_POPULATION_FOR_PERCENTILES = 10;

// Same PERCENT_RANK() approach as lib/scoring.ts's recomputeCityWidePercentiles,
// against the (much smaller, slower-growing) landlord_profiles population.
export async function recomputeLandlordPercentiles(pool: Pool): Promise<{ updated: number }> {
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*) as count FROM landlord_profiles');
  if (Number(rows[0].count) < MIN_POPULATION_FOR_PERCENTILES) {
    return { updated: 0 };
  }

  const result = await pool.query(`
    UPDATE landlord_profiles lp
    SET rating = ROUND((ranked.percentile * 100)::numeric, 1)
    FROM (
      SELECT landlord_key, PERCENT_RANK() OVER (ORDER BY raw_score ASC) AS percentile
      FROM landlord_profiles
    ) ranked
    WHERE lp.landlord_key = ranked.landlord_key
  `);
  return { updated: result.rowCount ?? 0 };
}
