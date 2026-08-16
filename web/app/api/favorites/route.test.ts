import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// spec 019's original Verification Oracle, extended in place per spec 020
// for the three-way requirePremiumTier() branch (unauthenticated/free/
// premium) on GET/POST/DELETE. Mocks requirePremiumTier() directly (the
// route's actual authorization boundary as of spec 020) rather than its
// internal cookie/Firebase machinery — that machinery is already proven
// separately by requirePremiumTier()'s own call sites
// (app/api/landlord/route.test.ts) and by firebaseAdmin.test.ts.

function mockRequirePremiumTier(
  result:
    | { authorized: true; uid: string; email: string }
    | { authorized: false; reason: 'unauthenticated' | 'not-premium' }
) {
  const requirePremiumTierMock = vi.fn().mockResolvedValue(result);
  vi.doMock('@/lib/requirePremiumTier', () => ({ requirePremiumTier: requirePremiumTierMock }));
  return requirePremiumTierMock;
}

describe('GET/POST/DELETE /api/favorites', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    vi.doUnmock('@/lib/requirePremiumTier');
    vi.doUnmock('@/lib/favorites');
  });

  describe('(a) unauthenticated', () => {
    it('GET returns 401 and never calls the DB', async () => {
      const requirePremiumTierMock = mockRequirePremiumTier({ authorized: false, reason: 'unauthenticated' });
      const listFavoritesForUserMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: listFavoritesForUserMock,
        addFavorite: vi.fn(),
        removeFavorite: vi.fn(),
      }));

      const { GET } = await import('./route');
      const response = await GET();

      expect(response.status).toBe(401);
      expect(requirePremiumTierMock).toHaveBeenCalled();
      expect(listFavoritesForUserMock).not.toHaveBeenCalled();
    });

    it('POST returns 401 and never calls addFavorite', async () => {
      mockRequirePremiumTier({ authorized: false, reason: 'unauthenticated' });
      const addFavoriteMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: vi.fn(),
        addFavorite: addFavoriteMock,
        removeFavorite: vi.fn(),
      }));

      const { POST } = await import('./route');
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ type: 'building', key: 'bldg-1' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(addFavoriteMock).not.toHaveBeenCalled();
    });

    it('DELETE returns 401 and never calls removeFavorite', async () => {
      mockRequirePremiumTier({ authorized: false, reason: 'unauthenticated' });
      const removeFavoriteMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: vi.fn(),
        addFavorite: vi.fn(),
        removeFavorite: removeFavoriteMock,
      }));

      const { DELETE } = await import('./route');
      const request = new Request('http://localhost/api/favorites', {
        method: 'DELETE',
        body: JSON.stringify({ type: 'building', key: 'bldg-1' }),
      });
      const response = await DELETE(request);

      expect(response.status).toBe(401);
      expect(removeFavoriteMock).not.toHaveBeenCalled();
    });
  });

  describe("(b) authenticated but free tier -> 403 { error: 'premium_required' }", () => {
    it('GET returns 403 and never calls the DB', async () => {
      mockRequirePremiumTier({ authorized: false, reason: 'not-premium' });
      const listFavoritesForUserMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: listFavoritesForUserMock,
        addFavorite: vi.fn(),
        removeFavorite: vi.fn(),
      }));

      const { GET } = await import('./route');
      const response = await GET();

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body).toEqual({ error: 'premium_required' });
      expect(listFavoritesForUserMock).not.toHaveBeenCalled();
    });

    it('POST returns 403 and never calls addFavorite', async () => {
      mockRequirePremiumTier({ authorized: false, reason: 'not-premium' });
      const addFavoriteMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: vi.fn(),
        addFavorite: addFavoriteMock,
        removeFavorite: vi.fn(),
      }));

      const { POST } = await import('./route');
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ type: 'building', key: 'bldg-1' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body).toEqual({ error: 'premium_required' });
      expect(addFavoriteMock).not.toHaveBeenCalled();
    });

    it('DELETE returns 403 and never calls removeFavorite', async () => {
      mockRequirePremiumTier({ authorized: false, reason: 'not-premium' });
      const removeFavoriteMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: vi.fn(),
        addFavorite: vi.fn(),
        removeFavorite: removeFavoriteMock,
      }));

      const { DELETE } = await import('./route');
      const request = new Request('http://localhost/api/favorites', {
        method: 'DELETE',
        body: JSON.stringify({ type: 'building', key: 'bldg-1' }),
      });
      const response = await DELETE(request);

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body).toEqual({ error: 'premium_required' });
      expect(removeFavoriteMock).not.toHaveBeenCalled();
    });
  });

  describe('(c) premium tier -> existing behavior unchanged', () => {
    it('POST with an invalid type value returns 400 and never calls addFavorite', async () => {
      mockRequirePremiumTier({ authorized: true, uid: 'renter-uid-1', email: 'renter@example.com' });
      const addFavoriteMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: vi.fn(),
        addFavorite: addFavoriteMock,
        removeFavorite: vi.fn(),
      }));

      const { POST } = await import('./route');
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ type: 'landlordxyz', key: 'some-key' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(addFavoriteMock).not.toHaveBeenCalled();
    });

    it('POST with an empty key returns 400 and never calls addFavorite', async () => {
      mockRequirePremiumTier({ authorized: true, uid: 'renter-uid-1', email: 'renter@example.com' });
      const addFavoriteMock = vi.fn();
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: vi.fn(),
        addFavorite: addFavoriteMock,
        removeFavorite: vi.fn(),
      }));

      const { POST } = await import('./route');
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ type: 'building', key: '' }),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(addFavoriteMock).not.toHaveBeenCalled();
    });

    it('POST then GET with a premium session round-trips the saved resource into the GET response', async () => {
      mockRequirePremiumTier({ authorized: true, uid: 'renter-uid-1', email: 'renter@example.com' });
      const addFavoriteMock = vi.fn().mockResolvedValue(undefined);
      const listFavoritesForUserMock = vi.fn().mockResolvedValue({
        buildings: [{ building_id: 'bldg-1', street_name: 'Main St' }],
        landlords: [],
      });
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: listFavoritesForUserMock,
        addFavorite: addFavoriteMock,
        removeFavorite: vi.fn(),
      }));

      const { POST, GET } = await import('./route');

      const postRequest = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ type: 'building', key: 'bldg-1' }),
      });
      const postResponse = await POST(postRequest);
      expect(postResponse.status).toBe(200);
      expect(addFavoriteMock).toHaveBeenCalledWith(expect.anything(), 'renter-uid-1', 'building', 'bldg-1');

      const getResponse = await GET();
      expect(getResponse.status).toBe(200);
      const body = (await getResponse.json()) as { buildings: unknown[]; landlords: unknown[] };
      expect(body.buildings).toHaveLength(1);
      expect(listFavoritesForUserMock).toHaveBeenCalledWith(expect.anything(), 'renter-uid-1');
    });

    it('POST called twice with the same {type, key} does not throw or duplicate (idempotent ON CONFLICT DO NOTHING path)', async () => {
      // addFavorite itself owns the ON CONFLICT DO NOTHING SQL (lib/favorites.ts,
      // tested directly there via the DB-level constraint) — this route-level
      // test proves the handler calls addFavorite the same way both times and
      // never throws/short-circuits on a second identical POST.
      mockRequirePremiumTier({ authorized: true, uid: 'renter-uid-1', email: 'renter@example.com' });
      const addFavoriteMock = vi.fn().mockResolvedValue(undefined);
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: vi.fn(),
        addFavorite: addFavoriteMock,
        removeFavorite: vi.fn(),
      }));

      const { POST } = await import('./route');
      const makeRequest = () =>
        new Request('http://localhost/api/favorites', {
          method: 'POST',
          body: JSON.stringify({ type: 'building', key: 'bldg-1' }),
        });

      const firstResponse = await POST(makeRequest());
      const secondResponse = await POST(makeRequest());

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(addFavoriteMock).toHaveBeenCalledTimes(2);
      expect(addFavoriteMock).toHaveBeenNthCalledWith(1, expect.anything(), 'renter-uid-1', 'building', 'bldg-1');
      expect(addFavoriteMock).toHaveBeenNthCalledWith(2, expect.anything(), 'renter-uid-1', 'building', 'bldg-1');
    });
  });
});
