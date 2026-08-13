import { getPool } from '@/lib/pgClient';
import { getZipSummaryAndTopBuildings } from '@/lib/queries';
import { validateZipCode } from '@/lib/validation';
import { fetchAndLoadZip, LIVE_SEARCH_MAX_PAGES } from '@/lib/socrata';
import { isKnownNycZip } from '@/lib/nycZips';

// The live-Socrata-seed path below (LIVE_SEARCH_MAX_PAGES) is bounded but
// still measured up to ~28s for a first-time zip search — well past
// Vercel's 10s serverless default. Extends this route's execution window;
// every other route stays on the platform default since only this one does
// a synchronous external fetch.
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get('zip');

  const validation = validateZipCode(zip);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const pool = getPool();
    let result = await getZipSummaryAndTopBuildings(pool, zip as string);

    // Nothing seeded for this zip yet — fetch it live from Socrata and
    // cache it (spec 017), then re-read. Capped to LIVE_SEARCH_MAX_PAGES so
    // a violation-heavy zip still resolves within a serverless function's
    // execution window — a capped fetch caches the most recent open
    // violations rather than the complete set (buildQueryUrl orders by
    // inspectiondate DESC), and the cron sync route fills in the rest on
    // its next uncapped run. A Socrata failure here still resolves the
    // search: the caller just sees the pre-fetch (empty) result rather than
    // a 500, matching the cron route's fail-soft stance.
    //
    // Skipped entirely for a zip Socrata's own dataset has no record of
    // (lib/nycZips.ts): measured a genuinely nonexistent zip taking 15-45+
    // seconds to resolve as "no results" rather than returning quickly —
    // Socrata doesn't appear to short-circuit an empty result set the way
    // you'd expect, so retrying/waiting on it here would make the "not a
    // real zip" case the slowest path in the app instead of the fastest.
    if (result.summary.totalBuildings === 0 && isKnownNycZip(zip as string)) {
      try {
        await fetchAndLoadZip(pool, zip as string, LIVE_SEARCH_MAX_PAGES);
        result = await getZipSummaryAndTopBuildings(pool, zip as string);
      } catch (error) {
        console.error(`Live Socrata fetch failed for zip ${zip}:`, error);
      }
    }

    return Response.json(result);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
