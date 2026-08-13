// Live fetch client for the NYC HPD Housing Maintenance Code Violations
// dataset (Socrata, wvxf-dwi5). Direct implementation of
// context/API_INTEGRATION.md §2's buildQueryUrl/paginated-fetch pattern —
// see that doc for the full field reference and rationale.
//
// OPEN-only is a product invariant, not a caller option (CLAUDE.md,
// context/API_INTEGRATION.md §1/§8): the status clause is a hardcoded
// constant baked into every query. Zip is the only dynamic SoQL input, and
// it is validated with the project's standing /^\d{5}$/ pattern before it
// ever touches the query string.
import type { Pool } from 'pg';
import { validateZipCode } from './validation';
import type { RawViolationRow } from './csvLoader';
import { loadIntoDb } from './loadIntoDb';

const DATASET_ID = 'wvxf-dwi5';
const BASE_URL = `https://data.cityofnewyork.us/api/v3/views/${DATASET_ID}/query.json`;

// OPEN-only is a product invariant, not a caller option. The app never
// surfaces closed violations, so status is never a parameter anywhere in
// this module.
const STATUS_CLAUSE = "upper(`violationstatus`) LIKE '%OPEN%'";

// The 41 columns pulled from the dataset — defined once, per
// context/API_INTEGRATION.md §1/§7.
const COLUMNS = [
  'violationid', 'buildingid', 'registrationid', 'boroid', 'boro',
  'housenumber', 'lowhousenumber', 'highhousenumber', 'streetname', 'streetcode',
  'zip', 'apartment', 'story', 'block', 'lot', 'class',
  'inspectiondate', 'approveddate', 'originalcertifybydate', 'originalcorrectbydate',
  'newcertifybydate', 'newcorrectbydate', 'certifieddate', 'ordernumber',
  'novid', 'novdescription', 'novissueddate', 'currentstatusid', 'currentstatus',
  'currentstatusdate', 'novtype', 'violationstatus', 'rentimpairing',
  'latitude', 'longitude', 'communityboard', 'councildistrict', 'censustract',
  'bin', 'bbl', 'nta',
].join(', ');

const PAGE_SIZE = 1000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

// Raw Socrata response shape — every field arrives as a string (or is
// absent), per context/API_INTEGRATION.md §5. Callers cast explicitly where
// numeric/boolean values are needed (e.g. parseFloat for latitude/longitude,
// === 'Y' for rentimpairing) rather than this module coercing on their
// behalf.
export interface SocrataViolationRow {
  violationid: string;
  buildingid: string;
  registrationid?: string;
  boroid?: string;
  boro?: string;
  housenumber?: string;
  lowhousenumber: string;
  highhousenumber: string;
  streetname: string;
  streetcode?: string;
  zip: string;
  apartment?: string;
  story?: string;
  block?: string;
  lot?: string;
  class?: string;
  inspectiondate: string;
  approveddate?: string;
  originalcertifybydate?: string;
  originalcorrectbydate?: string;
  newcertifybydate?: string;
  newcorrectbydate?: string;
  certifieddate?: string;
  ordernumber?: string;
  novid?: string;
  novdescription: string;
  novissueddate?: string;
  currentstatusid?: string;
  currentstatus: string;
  currentstatusdate?: string;
  novtype: string;
  violationstatus: string;
  rentimpairing: string;
  latitude: string;
  longitude: string;
  communityboard?: string;
  councildistrict?: string;
  censustract?: string;
  bin: string;
  bbl: string;
  nta?: string;
}

// Fields a downstream loader (loadIntoDb, via csvLoader's aggregateBuildings
// shape) requires on every row. Anything missing here is schema drift —
// logged and dropped before the row ever reaches the DB layer, never
// silently coerced (per this spec's Edge Cases).
const REQUIRED_FIELDS: readonly (keyof SocrataViolationRow)[] = [
  'violationid',
  'buildingid',
  'lowhousenumber',
  'highhousenumber',
  'streetname',
  'zip',
  'inspectiondate',
  'currentstatus',
  'novdescription',
  'novtype',
  'violationstatus',
  'rentimpairing',
  'latitude',
  'longitude',
  'bin',
  'bbl',
];

interface BuildQueryUrlOptions {
  zip: string;
  limit?: number;
  offset?: number;
}

// Validate the one dynamic input before it touches the query string. Reuses
// the project's single standing zip validator (lib/validation.ts) rather
// than re-declaring the /^\d{5}$/ pattern a second time.
export function buildQueryUrl({ zip, limit = PAGE_SIZE, offset = 0 }: BuildQueryUrlOptions): string {
  const validation = validateZipCode(zip);
  if (!validation.valid) {
    throw new Error(`Invalid zip: ${zip}`);
  }

  const soql = [
    `SELECT ${COLUMNS}`,
    `WHERE upper(\`zip\`) LIKE '%${zip}%'`,
    `AND ${STATUS_CLAUSE}`, // OPEN, always — never a caller parameter
    `LIMIT ${limit}`,
    `OFFSET ${offset}`,
  ].join(' ');

  return `${BASE_URL}?query=${encodeURIComponent(soql)}`;
}

// Returns true if `row` has every field this app's downstream loader
// requires. Schema drift (a Socrata column renamed/removed upstream) fails
// this check rather than reaching loadIntoDb with an undefined value.
export function isValidSocrataRow(row: unknown): row is SocrataViolationRow {
  if (typeof row !== 'object' || row === null) return false;
  const candidate = row as Record<string, unknown>;
  return REQUIRED_FIELDS.every((field) => typeof candidate[field] === 'string' && candidate[field] !== '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Hand-rolled retry/backoff (no dependency — see spec Constraints): retries
// a single page fetch up to MAX_RETRIES times with exponential backoff
// before giving up on that page.
async function fetchPageWithRetry(url: string): Promise<SocrataViolationRow[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          // App token lifts the shared anonymous rate limit — sent as a
          // header only, never in the query string (API_INTEGRATION.md §4/§8).
          'X-App-Token': process.env.NYC_APP_TOKEN ?? '',
        },
      });

      if (!response.ok) {
        throw new Error(`Socrata ${response.status}: ${await response.text()}`);
      }

      const page: unknown = await response.json();
      if (!Array.isArray(page)) {
        throw new Error('Socrata schema mismatch: response body is not an array');
      }

      return page as SocrataViolationRow[];
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(INITIAL_RETRY_DELAY_MS * 2 ** attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// Direct implementation of context/API_INTEGRATION.md §2's paginated-fetch
// pattern. Takes only a zip — status is never passed because it never
// changes (OPEN is invariant).
export async function fetchOpenViolations(zip: string): Promise<SocrataViolationRow[]> {
  const validation = validateZipCode(zip);
  if (!validation.valid) {
    throw new Error(`Invalid zip: ${zip}`);
  }

  const allRows: SocrataViolationRow[] = [];
  let offset = 0;

  while (true) {
    const url = buildQueryUrl({ zip, limit: PAGE_SIZE, offset });
    const page = await fetchPageWithRetry(url);
    allRows.push(...page);

    if (page.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  return allRows;
}

// Maps the Socrata response shape (lowercase keys, all strings) onto the
// loader's expected RawViolationRow shape — per
// context/API_INTEGRATION.md §6's documented key mapping (e.g.
// `lowhousenumber` -> `LowHouseNumber`). Shared by the cron sync route and
// the on-demand zip-search seed path below.
export function toRawViolationRow(row: SocrataViolationRow): RawViolationRow {
  return {
    ViolationID: row.violationid,
    BuildingID: row.buildingid,
    Postcode: row.zip,
    HouseNumber: row.housenumber ?? row.lowhousenumber,
    LowHouseNumber: row.lowhousenumber,
    HighHouseNumber: row.highhousenumber,
    StreetName: row.streetname,
    InspectionDate: row.inspectiondate,
    CurrentStatus: row.currentstatus,
    ViolationStatus: row.violationstatus,
    RentImpairing: row.rentimpairing,
    NOVDescription: row.novdescription,
    NovType: row.novtype,
    Latitude: row.latitude,
    Longitude: row.longitude,
    BIN: row.bin,
    BBL: row.bbl,
  };
}

// On-demand seed path for a zip a user just searched that has no rows in
// Postgres yet (spec 017): fetches it live from Socrata, validates each row
// against the dataset's required-field shape (schema drift is logged and
// skipped, never silently coerced — same contract as the cron sync route),
// and persists it before the caller re-reads from the DB. Fail-soft: a
// Socrata error here is the caller's to handle, not swallowed, since an
// empty zip search result is the fallback either way.
export async function fetchAndLoadZip(
  pool: Pool,
  zip: string
): Promise<{ buildingsLoaded: number; violationsLoaded: number; skippedRows: number }> {
  const rawRows = await fetchOpenViolations(zip);

  const validRows: RawViolationRow[] = [];
  let skippedRows = 0;
  for (const row of rawRows) {
    if (isValidSocrataRow(row)) {
      validRows.push(toRawViolationRow(row));
    } else {
      skippedRows += 1;
      console.error(`Socrata schema mismatch for zip ${zip}: row missing required fields`, row);
    }
  }

  const { buildingsLoaded, violationsLoaded } = await loadIntoDb(pool, validRows);
  return { buildingsLoaded, violationsLoaded, skippedRows };
}
