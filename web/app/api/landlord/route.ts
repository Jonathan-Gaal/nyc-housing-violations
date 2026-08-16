import { getPool } from '@/lib/pgClient';
import { getOrFetchLandlordProfile } from '@/lib/landlordProfile';
import { requirePremiumTier } from '@/lib/requirePremiumTier';

// Same latency class as /api/violations's landlord lookup — see that
// route's identical rationale. Usually a cache hit here though, since the
// BuildingCard view that links to this page already triggered the fetch.
export const maxDuration = 60;

// Landlord portfolio profiles are premium-gated (spec 020): unauthenticated
// -> 401, authenticated-but-free -> 403 { error: 'premium_required' },
// premium -> existing behavior unchanged. requirePremiumTier() derives
// identity from the verified session cookie only — never trusts a
// client-reported tier (spec 020 Security Constraints).
export async function GET(request: Request) {
  const tierResult = await requirePremiumTier();
  if (!tierResult.authorized) {
    const status = tierResult.reason === 'unauthenticated' ? 401 : 403;
    const body =
      tierResult.reason === 'unauthenticated'
        ? { authenticated: false }
        : { error: 'premium_required' };
    return Response.json(body, { status });
  }

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
