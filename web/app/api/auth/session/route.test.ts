import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spec 015's own declared test file: asserts the Set-Cookie response header
// includes HttpOnly, Secure, and SameSite=Strict attributes — the primary,
// literal-string proof that the corrected (not localStorage) pattern was
// implemented (spec 015 Test Constraints).
//
// Mode-2 correction (ratchet): the session cookie's value must be a
// cryptographically signed session cookie (Firebase Admin SDK's
// createSessionCookie), never the raw unsigned Firebase UID — an unsigned
// UID string is trivially forgeable by any client setting
// `Cookie: session=<any-uid>`. This file now also proves the other half of
// that fix: a forged/tampered cookie value is rejected by GET
// /api/auth/me, not silently trusted via a raw DB lookup.

function makeSessionRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_DECODED_TOKEN = {
  uid: 'test-firebase-uid',
  email: 'renter@example.com',
  aud: 'test-project',
  iss: 'https://securetoken.google.com/test-project',
  auth_time: 1723420800,
  iat: 1723420800,
  exp: 1723424400,
  sub: 'test-firebase-uid',
  firebase: { identities: {}, sign_in_provider: 'password' },
};

const SIGNED_SESSION_COOKIE_VALUE = 'signed-session-cookie-value-from-firebase';

describe('POST /api/auth/session', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    vi.doUnmock('@/lib/firebaseAdmin');
  });

  it('returns 400 when the request body is not valid JSON', async () => {
    const verifyIdTokenMock = vi.fn();
    const createSessionCookieMock = vi.fn();
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifyIdToken: verifyIdTokenMock,
      createSessionCookie: createSessionCookieMock,
    }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn() }));

    const { POST } = await import('./route');
    const request = new Request('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
    expect(createSessionCookieMock).not.toHaveBeenCalled();
  });

  it('returns 400 when idToken is missing from the body', async () => {
    const verifyIdTokenMock = vi.fn();
    const createSessionCookieMock = vi.fn();
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifyIdToken: verifyIdTokenMock,
      createSessionCookie: createSessionCookieMock,
    }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: vi.fn() }));

    const { POST } = await import('./route');
    const response = await POST(makeSessionRequest({}));

    expect(response.status).toBe(400);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
    expect(createSessionCookieMock).not.toHaveBeenCalled();
  });

  it('returns 401 with no Set-Cookie header and no DB write when the token is invalid/tampered', async () => {
    const verifyIdTokenMock = vi.fn().mockRejectedValue(new Error('Firebase ID token has invalid signature'));
    const createSessionCookieMock = vi.fn();
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifyIdToken: verifyIdTokenMock,
      createSessionCookie: createSessionCookieMock,
    }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST(makeSessionRequest({ idToken: 'tampered-token' }));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
    expect(createSessionCookieMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the decoded token has no email claim', async () => {
    const verifyIdTokenMock = vi.fn().mockResolvedValue({ ...VALID_DECODED_TOKEN, email: undefined });
    const createSessionCookieMock = vi.fn();
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifyIdToken: verifyIdTokenMock,
      createSessionCookie: createSessionCookieMock,
    }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST(makeSessionRequest({ idToken: 'valid-token-no-email' }));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
    expect(createSessionCookieMock).not.toHaveBeenCalled();
  });

  it('on success, sets a Set-Cookie header with HttpOnly, Secure, and SameSite=Strict, using a signed session cookie (not the raw UID or ID token)', async () => {
    const verifyIdTokenMock = vi.fn().mockResolvedValue(VALID_DECODED_TOKEN);
    const createSessionCookieMock = vi.fn().mockResolvedValue(SIGNED_SESSION_COOKIE_VALUE);
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: 'test-firebase-uid', email: 'renter@example.com', tier: 'free' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifyIdToken: verifyIdTokenMock,
      createSessionCookie: createSessionCookieMock,
    }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST, SESSION_COOKIE_NAME } = await import('./route');
    const response = await POST(makeSessionRequest({ idToken: 'valid-test-token' }));

    expect(response.status).toBe(200);

    const setCookieHeader = response.headers.get('set-cookie');
    expect(setCookieHeader).not.toBeNull();
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('Secure');
    expect(setCookieHeader).toContain('SameSite=Strict');
    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=${SIGNED_SESSION_COOKIE_VALUE}`);

    // createSessionCookie is called with the raw ID token (Firebase's own
    // API contract) — this is a separate exchange from what gets stored:
    // the ID token itself must still never appear in the Set-Cookie value.
    expect(createSessionCookieMock).toHaveBeenCalledWith('valid-test-token', expect.any(Number));
    expect(setCookieHeader).not.toContain('valid-test-token');

    // The unsigned raw UID must not appear as the cookie's own value either
    // — only the opaque signed cookie value from createSessionCookie
    // should be set (this is precisely the vulnerability being corrected:
    // the cookie must not just BE the UID).
    expect(setCookieHeader?.split(';')[0]).toBe(`${SESSION_COOKIE_NAME}=${SIGNED_SESSION_COOKIE_VALUE}`);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sqlText, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sqlText).toMatch(/ON CONFLICT \(firebase_uid\) DO UPDATE/);
    expect(params).toEqual(['test-firebase-uid', 'renter@example.com']);

    const responseBody = (await response.json()) as { uid: string; email: string; tier: string };
    expect(responseBody).toEqual({ uid: 'test-firebase-uid', email: 'renter@example.com', tier: 'free' });
  });

  it('returns 500 and no Set-Cookie header when the user upsert fails', async () => {
    const verifyIdTokenMock = vi.fn().mockResolvedValue(VALID_DECODED_TOKEN);
    const createSessionCookieMock = vi.fn().mockResolvedValue(SIGNED_SESSION_COOKIE_VALUE);
    const queryMock = vi.fn().mockRejectedValue(new Error('connection lost'));
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifyIdToken: verifyIdTokenMock,
      createSessionCookie: createSessionCookieMock,
    }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST(makeSessionRequest({ idToken: 'valid-test-token' }));

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns 500 and no Set-Cookie header when createSessionCookie itself fails', async () => {
    const verifyIdTokenMock = vi.fn().mockResolvedValue(VALID_DECODED_TOKEN);
    const createSessionCookieMock = vi.fn().mockRejectedValue(new Error('Firebase session cookie creation failed'));
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: 'test-firebase-uid', email: 'renter@example.com', tier: 'free' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/firebaseAdmin', () => ({
      verifyIdToken: verifyIdTokenMock,
      createSessionCookie: createSessionCookieMock,
    }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST(makeSessionRequest({ idToken: 'valid-test-token' }));

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('GET /api/auth/me — forged/tampered session cookie rejection', () => {
  // This is the exact test case ratchet's Mode 2 review found missing: a
  // session cookie string that is not a real, valid createSessionCookie()
  // output (e.g. an attacker setting `Cookie: session=<any-firebase-uid>`
  // directly, with no valid Firebase session behind it) must be rejected
  // by verifySessionCookie() and never reach the database lookup.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    vi.doUnmock('@/lib/firebaseAdmin');
    vi.doUnmock('next/headers');
  });

  function mockCookieStore(cookieValue: string | undefined) {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({
        get: (name: string) =>
          name === 'session' && cookieValue !== undefined ? { name, value: cookieValue } : undefined,
      }),
    }));
  }

  it('rejects a forged cookie value (not a real signed session cookie) with 401, never querying the DB', async () => {
    const verifySessionCookieMock = vi
      .fn()
      .mockRejectedValue(new Error('Firebase ID token has invalid signature'));
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });

    mockCookieStore('any-firebase-uid-an-attacker-just-typed-in');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { GET } = await import('../me/route');
    const response = await GET();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { authenticated: boolean };
    expect(body).toEqual({ authenticated: false });

    // The forgery-proof: the DB is never even queried with the forged
    // value — verifySessionCookie rejects it first.
    expect(queryMock).not.toHaveBeenCalled();
    expect(verifySessionCookieMock).toHaveBeenCalledWith('any-firebase-uid-an-attacker-just-typed-in');
  });

  it('returns 401 with { authenticated: false } when no session cookie is present at all', async () => {
    const verifySessionCookieMock = vi.fn();
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });

    mockCookieStore(undefined);
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { GET } = await import('../me/route');
    const response = await GET();

    expect(response.status).toBe(401);
    expect(verifySessionCookieMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts a genuinely valid, cryptographically verified session cookie and returns the profile from the verified UID', async () => {
    const verifySessionCookieMock = vi.fn().mockResolvedValue({ uid: 'test-firebase-uid' });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: 'test-firebase-uid', email: 'renter@example.com', tier: 'free' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });

    mockCookieStore(SIGNED_SESSION_COOKIE_VALUE);
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { GET } = await import('../me/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(verifySessionCookieMock).toHaveBeenCalledWith(SIGNED_SESSION_COOKIE_VALUE);

    // The DB lookup must use the UID extracted from the verified decoded
    // result, not the raw cookie string.
    const [sqlText, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sqlText).toMatch(/SELECT .* FROM users WHERE firebase_uid = \$1/);
    expect(params).toEqual(['test-firebase-uid']);

    const body = (await response.json()) as { uid: string; email: string; tier: string };
    expect(body).toEqual({ uid: 'test-firebase-uid', email: 'renter@example.com', tier: 'free' });
  });
});
