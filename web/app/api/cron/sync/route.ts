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
import { fetchAndLoadZip } from '@/lib/socrata';
import { recomputeCityWidePercentiles } from '@/lib/scoring';

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
      const { buildingsLoaded, violationsLoaded, skippedRows } = await fetchAndLoadZip(pool, zip);
      results.push({ zip, status: 'ok', buildingsLoaded, violationsLoaded, skippedRows });
    } catch (error) {
      // Fail-soft per-zip (specs/008 Edge Cases + FORCES #4): one zip's
      // Socrata error is logged and does not abort the loop for the rest.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Sync failed for zip ${zip}: ${message}`);
      results.push({ zip, status: 'error', error: message });
    }
  }

  // Ratings written during the loop above are provisional (raw_score copied
  // straight into rating — see loadIntoDb.ts). Recompute the authoritative
  // citywide percentile once per run, after all zips are loaded, not once
  // per zip — a percentile is only meaningful against the full population.
  const { updated: ratingsRecomputed } = await recomputeCityWidePercentiles(pool);

  return Response.json({ syncedZips: results.length, results, ratingsRecomputed });
}
