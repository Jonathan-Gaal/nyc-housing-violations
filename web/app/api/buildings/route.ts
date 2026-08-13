import { getPool } from '@/lib/pgClient';
import { getZipSummaryAndTopBuildings } from '@/lib/queries';
import { validateZipCode } from '@/lib/validation';
import { fetchAndLoadZip } from '@/lib/socrata';

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
    // cache it (spec 017), then re-read. A Socrata failure here still
    // resolves the search: the caller just sees the pre-fetch (empty)
    // result rather than a 500, matching the cron route's fail-soft stance.
    if (result.summary.totalBuildings === 0) {
      try {
        await fetchAndLoadZip(pool, zip as string);
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
