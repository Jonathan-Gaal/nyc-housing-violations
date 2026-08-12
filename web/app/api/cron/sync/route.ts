// Vercel Cron entry point (see web/vercel.json's `crons` config). Vercel's
// infrastructure hits this GET route on a schedule and signs the request
// with `Authorization: Bearer $CRON_SECRET` — there is no persistent
// process on Vercel's serverless platform, so a scheduled-HTTP-endpoint is
// the only viable recurring-job pattern here (specs/008, Design Pattern).
//
// Per specs/008 Edge Cases: a single zip's Socrata failure must not abort
// the sync for the remaining zips (fail-soft per-zip, not fail-hard
// whole-sync). Schema-mismatch rows are validated and logged before ever
// reaching loadIntoDb, never silently coerced.
import type { Pool } from 'pg';
import { getPool } from '@/lib/pgClient';
import { fetchOpenViolations, isValidSocrataRow, type SocrataViolationRow } from '@/lib/socrata';
import { loadIntoDb } from '@/lib/loadIntoDb';
import type { RawViolationRow } from '@/lib/csvLoader';

// Maps the Socrata response shape (lowercase keys, all strings) onto the
// loader's expected RawViolationRow shape — per
// context/API_INTEGRATION.md §6's documented key mapping (e.g.
// `lowhousenumber` -> `LowHouseNumber`).
function toRawViolationRow(row: SocrataViolationRow): RawViolationRow {
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

interface ZipSyncResult {
  zip: string;
  status: 'ok' | 'error';
  buildingsLoaded?: number;
  violationsLoaded?: number;
  skippedRows?: number;
  error?: string;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

// specs/008-socrata-live-fetch-cron.md: "iterates the set of zips already
// loaded in Postgres (SELECT DISTINCT postcode FROM buildings)". Inlined
// here (rather than added to lib/queries.ts) to stay within the spec's
// declared 5-file cap — this route is the query's only caller.
async function getDistinctPostcodes(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ postcode: string }>('SELECT DISTINCT postcode FROM buildings');
  return result.rows.map((row) => row.postcode);
}

export async function GET(request: Request) {
  // CRON_SECRET is validated before any Socrata call or DB write —
  // unauthenticated requests get 401 with no side effects (specs/008
  // Security Constraints).
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = getPool();
  const zips = await getDistinctPostcodes(pool);

  const results: ZipSyncResult[] = [];

  for (const zip of zips) {
    try {
      const rawRows = await fetchOpenViolations(zip);

      const validRows: RawViolationRow[] = [];
      let skippedRows = 0;
      for (const row of rawRows) {
        if (isValidSocrataRow(row)) {
          validRows.push(toRawViolationRow(row));
        } else {
          // Schema drift: logged, never silently coerced into the loader.
          skippedRows += 1;
          console.error(`Socrata schema mismatch for zip ${zip}: row missing required fields`, row);
        }
      }

      const { buildingsLoaded, violationsLoaded } = await loadIntoDb(pool, validRows);
      results.push({ zip, status: 'ok', buildingsLoaded, violationsLoaded, skippedRows });
    } catch (error) {
      // Fail-soft per-zip (specs/008 Edge Cases + FORCES #4): one zip's
      // Socrata error is logged and does not abort the loop for the rest.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Sync failed for zip ${zip}: ${message}`);
      results.push({ zip, status: 'error', error: message });
    }
  }

  return Response.json({ syncedZips: results.length, results });
}
