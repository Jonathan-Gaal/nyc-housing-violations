import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// spec 019's Verification Oracle. Mirrors spec 016's /upgrade route test
// mocking shape exactly (mockCookieStore/mocked verifySessionCookie/mocked
// pg pool) — no live Firebase/Supabase credentials required.

function mockCookieStore(cookieValue: string | undefined) {
  vi.doMock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({
      get: (name: string) =>
        name === 'session' && cookieValue !== undefined ? { name, value: cookieValue } : undefined,
    }),
  }));
}

describe('GET/POST/DELETE /api/favorites', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    vi.doUnmock('@/lib/firebaseAdmin');
    vi.doUnmock('@/lib/favorites');
    vi.doUnmock('next/headers');
  });

  describe('no session cookie or a cookie that fails verifySessionCookie()', () => {
    it('GET returns 401 and never calls the DB', async () => {
      const verifySessionCookieMock = vi.fn();
      const listFavoritesForUserMock = vi.fn();
      mockCookieStore(undefined);
      vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
      vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn().mockReturnValue({}) }));
      vi.doMock('@/lib/favorites', () => ({
        listFavoritesForUser: listFavoritesForUserMock,
        addFavorite: vi.fn(),
        removeFavorite: vi.fn(),
      }));

      const { GET } = await import('./route');
      const response = await GET();

      expect(response.status).toBe(401);
      expect(verifySessionCookieMock).not.toHaveBeenCalled();
      expect(listFavoritesForUserMock).not.toHaveBeenCalled();
    });

    it('POST returns 401 and never calls addFavorite when the cookie fails verification', async () => {
      const verifySessionCookieMock = vi.fn().mockRejectedValue(new Error('invalid signature'));
      const addFavoriteMock = vi.fn();
      mockCookieStore('forged-cookie-value');
      vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
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
      expect(verifySessionCookieMock).toHaveBeenCalledWith('forged-cookie-value');
      expect(addFavoriteMock).not.toHaveBeenCalled();
    });

    it('DELETE returns 401 and never calls removeFavorite when no cookie is present at all', async () => {
      const removeFavoriteMock = vi.fn();
      mockCookieStore(undefined);
      vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: vi.fn() }));
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

  it('POST with an invalid type value returns 400 and never calls addFavorite', async () => {
    const addFavoriteMock = vi.fn();
    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifySessionCookie: vi.fn().mockResolvedValue({ uid: 'renter-uid-1' }),
    }));
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
    const addFavoriteMock = vi.fn();
    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifySessionCookie: vi.fn().mockResolvedValue({ uid: 'renter-uid-1' }),
    }));
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

  it('POST then GET with a valid session round-trips the saved resource into the GET response', async () => {
    const addFavoriteMock = vi.fn().mockResolvedValue(undefined);
    const listFavoritesForUserMock = vi.fn().mockResolvedValue({
      buildings: [{ building_id: 'bldg-1', street_name: 'Main St' }],
      landlords: [],
    });
    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifySessionCookie: vi.fn().mockResolvedValue({ uid: 'renter-uid-1' }),
    }));
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
    const addFavoriteMock = vi.fn().mockResolvedValue(undefined);
    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifySessionCookie: vi.fn().mockResolvedValue({ uid: 'renter-uid-1' }),
    }));
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
