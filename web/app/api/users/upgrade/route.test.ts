import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// spec 016's Verification Oracle assertion (c): a request with no session
// cookie, or a cookie that fails verifySessionCookie(), is rejected 401 and
// never calls the Stripe client — proving this route enforces its own
// identity check rather than relying on middleware.ts's presence-only gate
// (spec 016 Amendment note, [FORCES] #5). Not listed in spec 016's own
// Files section (which is at its 5-file cap), but required by that same
// spec's Verification Oracle/Test Constraints sections, which explicitly
// call for this companion test — flagged here and in the completion
// report rather than silently adding or silently skipping it.

function mockCookieStore(cookieValue: string | undefined) {
  vi.doMock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({
      get: (name: string) =>
        name === 'session' && cookieValue !== undefined ? { name, value: cookieValue } : undefined,
    }),
    headers: vi.fn().mockResolvedValue(new Headers({ origin: 'http://localhost:3000' })),
  }));
}

function mockStripeClient() {
  const customersCreateMock = vi.fn();
  const checkoutSessionsCreateMock = vi.fn();
  const getStripeClientMock = vi.fn().mockReturnValue({
    customers: { create: customersCreateMock },
    checkout: { sessions: { create: checkoutSessionsCreateMock } },
  });
  vi.doMock('@/lib/stripe', () => ({ getStripeClient: getStripeClientMock }));
  return { getStripeClientMock, customersCreateMock, checkoutSessionsCreateMock };
}

describe('POST /api/users/upgrade', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    vi.doUnmock('@/lib/firebaseAdmin');
    vi.doUnmock('@/lib/stripe');
    vi.doUnmock('next/headers');
  });

  it('returns 401 and never constructs/calls a Stripe client when no session cookie is present at all', async () => {
    const verifySessionCookieMock = vi.fn();
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { getStripeClientMock } = mockStripeClient();

    mockCookieStore(undefined);
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { authenticated: boolean };
    expect(body).toEqual({ authenticated: false });

    expect(verifySessionCookieMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    // The critical assertion: no Stripe client is ever constructed on this
    // path, let alone called — the identity check happens strictly before
    // any Stripe interaction.
    expect(getStripeClientMock).not.toHaveBeenCalled();
  });

  it('returns 401 and never calls the Stripe client when the session cookie fails verifySessionCookie() (forged/tampered/expired)', async () => {
    const verifySessionCookieMock = vi.fn().mockRejectedValue(new Error('Firebase session cookie has invalid signature'));
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { getStripeClientMock } = mockStripeClient();

    mockCookieStore('any-firebase-uid-an-attacker-just-typed-in');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(response.status).toBe(401);
    expect(verifySessionCookieMock).toHaveBeenCalledWith('any-firebase-uid-an-attacker-just-typed-in');
    // The DB is never queried with the forged value, and Stripe is never
    // touched — this is the exact bypass class from Phase 12's original
    // vulnerability, proven closed here.
    expect(queryMock).not.toHaveBeenCalled();
    expect(getStripeClientMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the session cookie value is present but empty, without calling verifySessionCookie or Stripe', async () => {
    const verifySessionCookieMock = vi.fn();
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { getStripeClientMock } = mockStripeClient();

    mockCookieStore('   ');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(response.status).toBe(401);
    expect(verifySessionCookieMock).not.toHaveBeenCalled();
    expect(getStripeClientMock).not.toHaveBeenCalled();
  });

  it('returns 401 when verifySessionCookie succeeds but no matching user row exists, without calling Stripe', async () => {
    const verifySessionCookieMock = vi.fn().mockResolvedValue({ uid: 'renter-uid-1' });
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { getStripeClientMock } = mockStripeClient();

    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(response.status).toBe(401);
    expect(getStripeClientMock).not.toHaveBeenCalled();
  });

  it('on a genuinely valid session cookie, verifies identity first, then creates a Stripe Checkout session and returns its URL (never writing tier itself)', async () => {
    const verifySessionCookieMock = vi.fn().mockResolvedValue({ uid: 'renter-uid-1' });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: 'renter-uid-1', email: 'renter@example.com', stripe_customer_id: 'cus_existing' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { getStripeClientMock, customersCreateMock, checkoutSessionsCreateMock } = mockStripeClient();
    checkoutSessionsCreateMock.mockResolvedValue({ url: 'https://checkout.stripe.com/test-session' });

    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(verifySessionCookieMock).toHaveBeenCalledWith('valid-signed-session-cookie');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { checkoutUrl: string };
    expect(body).toEqual({ checkoutUrl: 'https://checkout.stripe.com/test-session' });

    expect(getStripeClientMock).toHaveBeenCalled();
    // Existing stripe_customer_id is reused rather than creating a new one.
    expect(customersCreateMock).not.toHaveBeenCalled();
    expect(checkoutSessionsCreateMock).toHaveBeenCalledTimes(1);
    const [checkoutSessionParams] = checkoutSessionsCreateMock.mock.calls[0] as [
      { customer: string; client_reference_id: string; mode: string },
    ];
    expect(checkoutSessionParams.customer).toBe('cus_existing');
    expect(checkoutSessionParams.client_reference_id).toBe('renter-uid-1');
    expect(checkoutSessionParams.mode).toBe('subscription');

    // The route never writes tier itself — only two queries ever run:
    // the initial user lookup. No UPDATE ... SET tier appears anywhere.
    for (const call of queryMock.mock.calls) {
      const [sqlText] = call as [string, unknown[]];
      expect(sqlText).not.toMatch(/tier\s*=\s*'premium'/i);
    }
  });

  // Regression test for a real, already-shipped defect (found post-commit
  // by soundwave's risk assessment): Stripe does NOT automatically copy a
  // Checkout Session's top-level `metadata` onto the Subscription object it
  // creates for `mode: 'subscription'` sessions — that only happens if
  // `subscription_data.metadata` is explicitly passed at session-creation
  // time. Without it, webhooks/stripe/route.ts's handleSubscriptionDeleted()
  // (which reads subscription.metadata.firebase_uid exclusively, with no
  // client_reference_id fallback) can never resolve a firebase_uid on
  // `customer.subscription.deleted`, so tier never reverts to 'free' on
  // cancellation — a silent, permanent premium-access leak. This test
  // exercises the actual Checkout Session creation call directly (unlike
  // the webhook route's own tests, which hand-construct payloads with
  // metadata.firebase_uid already populated and so never caught this) and
  // would have failed against the pre-fix code, where `subscription_data`
  // was never passed to `stripe.checkout.sessions.create(...)` at all.
  it('sets subscription_data.metadata.firebase_uid on the Checkout Session so the Subscription object itself carries firebase_uid (required for customer.subscription.deleted webhooks to resolve the user)', async () => {
    const verifiedFirebaseUid = 'renter-uid-1';
    const verifySessionCookieMock = vi.fn().mockResolvedValue({ uid: verifiedFirebaseUid });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: verifiedFirebaseUid, email: 'renter@example.com', stripe_customer_id: 'cus_existing' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { checkoutSessionsCreateMock } = mockStripeClient();
    checkoutSessionsCreateMock.mockResolvedValue({ url: 'https://checkout.stripe.com/test-session' });

    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(response.status).toBe(200);
    expect(checkoutSessionsCreateMock).toHaveBeenCalledTimes(1);
    const [checkoutSessionParams] = checkoutSessionsCreateMock.mock.calls[0] as [
      { subscription_data?: { metadata?: Record<string, string> } },
    ];
    expect(checkoutSessionParams.subscription_data).toBeDefined();
    expect(checkoutSessionParams.subscription_data?.metadata).toEqual({ firebase_uid: verifiedFirebaseUid });
  });
});
