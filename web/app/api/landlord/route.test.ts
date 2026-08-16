import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// spec 020's Verification Oracle for /api/landlord: the three-way branch
// (unauthenticated/free/premium). Not in spec 019's original Files list
// (this route predates favorites entirely), added here as an oracle-mandated
// test file the same way route.test.ts files were added beyond stated caps
// in specs 008/011/015 (see wiki log.md) — this route never had its own
// test file before, and spec 020's Verification Oracle explicitly requires
// one now that it has real branching logic to prove.

function buildLandlordRequest(): Request {
  const params = new URLSearchParams({
    firstName: 'Jane',
    lastName: 'Doe',
    officerName: 'Jane Doe',
  });
  return new Request(`http://localhost/api/landlord?${params.toString()}`);
}

describe('GET /api/landlord', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    vi.doUnmock('@/lib/landlordProfile');
    vi.doUnmock('@/lib/requirePremiumTier');
  });

  it('(a) unauthenticated -> 401, and getOrFetchLandlordProfile is never called', async () => {
    const requirePremiumTierMock = vi.fn().mockResolvedValue({
      authorized: false,
      reason: 'unauthenticated',
    });
    const getOrFetchLandlordProfileMock = vi.fn();
    vi.doMock('@/lib/requirePremiumTier', () => ({ requirePremiumTier: requirePremiumTierMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
    vi.doMock('@/lib/landlordProfile', () => ({ getOrFetchLandlordProfile: getOrFetchLandlordProfileMock }));

    const { GET } = await import('./route');
    const response = await GET(buildLandlordRequest());

    expect(response.status).toBe(401);
    expect(getOrFetchLandlordProfileMock).not.toHaveBeenCalled();
  });

  it("(b) authenticated but free tier -> 403 { error: 'premium_required' }, and getOrFetchLandlordProfile is never called", async () => {
    const requirePremiumTierMock = vi.fn().mockResolvedValue({
      authorized: false,
      reason: 'not-premium',
    });
    const getOrFetchLandlordProfileMock = vi.fn();
    vi.doMock('@/lib/requirePremiumTier', () => ({ requirePremiumTier: requirePremiumTierMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
    vi.doMock('@/lib/landlordProfile', () => ({ getOrFetchLandlordProfile: getOrFetchLandlordProfileMock }));

    const { GET } = await import('./route');
    const response = await GET(buildLandlordRequest());

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body).toEqual({ error: 'premium_required' });
    expect(getOrFetchLandlordProfileMock).not.toHaveBeenCalled();
  });

  it('(c) premium tier -> existing profile-fetch behavior unchanged', async () => {
    const requirePremiumTierMock = vi.fn().mockResolvedValue({
      authorized: true,
      uid: 'landlord-viewer-uid',
      email: 'viewer@example.com',
    });
    const mockProfile = { landlordKey: 'jane doe|', officerName: 'Jane Doe', buildingCount: 3 };
    const getOrFetchLandlordProfileMock = vi.fn().mockResolvedValue(mockProfile);
    vi.doMock('@/lib/requirePremiumTier', () => ({ requirePremiumTier: requirePremiumTierMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
    vi.doMock('@/lib/landlordProfile', () => ({ getOrFetchLandlordProfile: getOrFetchLandlordProfileMock }));

    const { GET } = await import('./route');
    const response = await GET(buildLandlordRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { profile: unknown };
    expect(body).toEqual({ profile: mockProfile });
    expect(getOrFetchLandlordProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      'Jane',
      'Doe',
      'Jane Doe',
      null
    );
  });

  it('still returns 400 for a premium user missing required query params, without calling getOrFetchLandlordProfile', async () => {
    const requirePremiumTierMock = vi.fn().mockResolvedValue({
      authorized: true,
      uid: 'landlord-viewer-uid',
      email: 'viewer@example.com',
    });
    const getOrFetchLandlordProfileMock = vi.fn();
    vi.doMock('@/lib/requirePremiumTier', () => ({ requirePremiumTier: requirePremiumTierMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
    vi.doMock('@/lib/landlordProfile', () => ({ getOrFetchLandlordProfile: getOrFetchLandlordProfileMock }));

    const { GET } = await import('./route');
    const response = await GET(new Request('http://localhost/api/landlord'));

    expect(response.status).toBe(400);
    expect(getOrFetchLandlordProfileMock).not.toHaveBeenCalled();
  });
});
