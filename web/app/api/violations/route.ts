import { getPool } from '@/lib/pgClient';
import { getViolationsForBuilding, getBuildingRegistrationId } from '@/lib/queries';
import { validateBuildingId } from '@/lib/validation';
import { getOrFetchLandlord } from '@/lib/landlords';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const buildingId = searchParams.get('buildingId');

  const validation = validateBuildingId(buildingId);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const pool = getPool();
    const violations = await getViolationsForBuilding(pool, buildingId as string);

    // Landlord lookup is best-effort: a Socrata hiccup here shouldn't break
    // the violations list, which is the core of this endpoint.
    let landlord = null;
    try {
      const registrationId = await getBuildingRegistrationId(pool, buildingId as string);
      landlord = registrationId ? await getOrFetchLandlord(pool, registrationId) : null;
    } catch (error) {
      console.error(`Landlord lookup failed for building ${buildingId}:`, error);
    }

    return Response.json({ violations, landlord });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
