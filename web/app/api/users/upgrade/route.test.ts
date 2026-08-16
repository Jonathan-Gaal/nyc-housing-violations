import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// spec 016's Verification Oracle assertion (c): a request with no session
// cookie, or a cookie that fails verifySessionCookie(), is rejected 401 and
// never calls the Stripe client — proving this route enforces its own
// identity check rather than relying on middleware.ts's presence-only gate
// (spec 016 Amendment note, [FORCES] #5). Extended in place per spec 022 for
// the in-app subscription/PaymentIntent flow: asserts { clientSecret }
// response shape (not { checkoutUrl }) with the correct subscriptions.create
// call args, and that no UPDATE users SET tier query ever fires — proving
// the webhook-as-source-of-truth invariant survived this spec's rewrite of
// the route's success-path body.

function mockCookieStore(cookieValue: string | undefined) {
  vi.doMock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({
      get: (name: string) =>
        name === 'session' && cookieValue !== undefined ? { name, value: cookieValue } : undefined,
    }),
  }));
}

function mockStripeClient() {
  const customersCreateMock = vi.fn();
  const productsRetrieveMock = vi.fn().mockResolvedValue({ id: 'homecheck-nyc-premium-tier' });
  const productsCreateMock = vi.fn().mockResolvedValue({ id: 'homecheck-nyc-premium-tier' });
  const subscriptionsCreateMock = vi.fn();
  const getStripeClientMock = vi.fn().mockReturnValue({
    customers: { create: customersCreateMock },
    products: { retrieve: productsRetrieveMock, create: productsCreateMock },
    subscriptions: { create: subscriptionsCreateMock },
  });
  vi.doMock('@/lib/stripe', () => ({ getStripeClient: getStripeClientMock }));
  return { getStripeClientMock, customersCreateMock, productsRetrieveMock, productsCreateMock, subscriptionsCreateMock };
}

// Matches subscriptions.create's expand: ['latest_invoice.payment_intent']
// shape — an already-expanded Invoice with an already-expanded PaymentIntent.
function buildSubscriptionResponse(clientSecret: string) {
  return {
    id: 'sub_test_123',
    latest_invoice: {
      id: 'in_test_123',
      payment_intent: { id: 'pi_test_123', client_secret: clientSecret },
    },
  };
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

  it('on a genuinely valid session cookie, verifies identity first, then creates an in-app subscription and returns { clientSecret } (never { checkoutUrl }, never writing tier itself)', async () => {
    const verifySessionCookieMock = vi.fn().mockResolvedValue({ uid: 'renter-uid-1' });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: 'renter-uid-1', email: 'renter@example.com', stripe_customer_id: 'cus_existing' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { getStripeClientMock, customersCreateMock, subscriptionsCreateMock } = mockStripeClient();
    subscriptionsCreateMock.mockResolvedValue(buildSubscriptionResponse('pi_test_123_secret_abc'));

    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(verifySessionCookieMock).toHaveBeenCalledWith('valid-signed-session-cookie');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ clientSecret: 'pi_test_123_secret_abc' });
    expect(body.checkoutUrl).toBeUndefined();

    expect(getStripeClientMock).toHaveBeenCalled();
    // Existing stripe_customer_id is reused rather than creating a new one.
    expect(customersCreateMock).not.toHaveBeenCalled();
    expect(subscriptionsCreateMock).toHaveBeenCalledTimes(1);
    const [subscriptionParams] = subscriptionsCreateMock.mock.calls[0] as [
      {
        customer: string;
        payment_behavior: string;
        expand: string[];
        metadata?: Record<string, string>;
      },
    ];
    expect(subscriptionParams.customer).toBe('cus_existing');
    expect(subscriptionParams.payment_behavior).toBe('default_incomplete');
    expect(subscriptionParams.expand).toEqual(['latest_invoice.payment_intent']);
    expect(subscriptionParams.metadata).toEqual({ firebase_uid: 'renter-uid-1' });

    // The route never writes tier itself — only the initial user-lookup
    // query runs. No UPDATE ... SET tier appears anywhere, proving the
    // webhook-as-source-of-truth invariant survived this route's rewrite.
    for (const call of queryMock.mock.calls) {
      const [sqlText] = call as [string, unknown[]];
      expect(sqlText).not.toMatch(/tier\s*=\s*'premium'/i);
    }
  });

  it('sets metadata.firebase_uid directly on the Subscription object (required for customer.subscription.deleted webhooks to resolve the user)', async () => {
    const verifiedFirebaseUid = 'renter-uid-1';
    const verifySessionCookieMock = vi.fn().mockResolvedValue({ uid: verifiedFirebaseUid });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: verifiedFirebaseUid, email: 'renter@example.com', stripe_customer_id: 'cus_existing' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { subscriptionsCreateMock } = mockStripeClient();
    subscriptionsCreateMock.mockResolvedValue(buildSubscriptionResponse('pi_test_456_secret_def'));

    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(response.status).toBe(200);
    expect(subscriptionsCreateMock).toHaveBeenCalledTimes(1);
    const [subscriptionParams] = subscriptionsCreateMock.mock.calls[0] as [{ metadata?: Record<string, string> }];
    expect(subscriptionParams.metadata).toEqual({ firebase_uid: verifiedFirebaseUid });
  });

  it('returns 500 if Stripe returns a subscription with no resolvable PaymentIntent client secret, without ever writing tier', async () => {
    const verifySessionCookieMock = vi.fn().mockResolvedValue({ uid: 'renter-uid-1' });
    const queryMock = vi.fn().mockResolvedValue({
      rows: [{ firebase_uid: 'renter-uid-1', email: 'renter@example.com', stripe_customer_id: 'cus_existing' }],
    });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const { subscriptionsCreateMock } = mockStripeClient();
    subscriptionsCreateMock.mockResolvedValue({ id: 'sub_test_broken', latest_invoice: null });

    mockCookieStore('valid-signed-session-cookie');
    vi.doMock('@/lib/firebaseAdmin', () => ({ verifySessionCookie: verifySessionCookieMock }));
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const response = await POST();

    expect(response.status).toBe(500);
    for (const call of queryMock.mock.calls) {
      const [sqlText] = call as [string, unknown[]];
      expect(sqlText).not.toMatch(/tier\s*=\s*'premium'/i);
    }
  });
});
