import { getPool } from '@/lib/pgClient';
import { getOrFetchLandlordProfile } from '@/lib/landlordProfile';

// Same latency class as /api/violations's landlord lookup — see that
// route's identical rationale. Usually a cache hit here though, since the
// BuildingCard view that links to this page already triggered the fetch.
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const firstName = searchParams.get('firstName');
  const lastName = searchParams.get('lastName');
  const officerName = searchParams.get('officerName');
  const businessAddress = searchParams.get('businessAddress');

  if (!firstName || !lastName || !officerName) {
    return Response.json({ error: 'firstName, lastName, and officerName are required' }, { status: 400 });
  }

  try {
    const pool = getPool();
    const profile = await getOrFetchLandlordProfile(
      pool,
      firstName,
      lastName,
      officerName,
      businessAddress
    );
    return Response.json({ profile });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
