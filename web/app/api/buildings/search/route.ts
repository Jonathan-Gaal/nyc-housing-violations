import { getPool } from '@/lib/pgClient';
import { searchBuildingsByAddress } from '@/lib/queries';
import { validateSearchQuery } from '@/lib/validation';

// Street/address search — Postgres-only (see lib/queries.ts's
// searchBuildingsByAddress for why this never touches Socrata), so it stays
// on the platform's default execution window unlike /api/buildings's
// live-fetch path.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  const validation = validateSearchQuery(q);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const pool = getPool();
    const result = await searchBuildingsByAddress(pool, (q as string).trim());
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
