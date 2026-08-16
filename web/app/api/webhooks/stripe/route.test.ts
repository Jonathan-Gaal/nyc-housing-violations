import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

// spec 016's declared Verification Oracle file, extended per spec 023's
// webhook-event correction. Uses Stripe's own documented test-mode webhook
// signing utility (Stripe.webhooks.generateTestHeaderString) to produce a
// genuine HMAC signature against a known test secret — this is fully
// offline-testable and does not require a live Stripe account or test-mode
// keys (per the spec's own credential-blocked-pattern design). The
// signature-verification step itself is never mocked: this is the file
// proving the single most important security property in this spec
// (Intellectual Control) — an attacker POSTing a fake webhook payload
// without a valid signature must never be able to grant free premium
// access.
//
// checkout.session.completed coverage is removed (not left dead alongside
// the new coverage) — spec 023 Constraints: handleCheckoutSessionCompleted
// no longer exists in the route, since that event never fires for spec
// 022's in-app subscription flow. customer.subscription.created/.updated
// (status-gated) replace it as the events that actually grant premium.

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_only';
const ORIGINAL_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

function buildSubscriptionEventPayload(overrides: {
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted';
  firebaseUid?: string;
  status?: string;
  stripeCustomerId?: string | null;
  eventId?: string;
  subscriptionId?: string;
}) {
  return JSON.stringify({
    id: overrides.eventId ?? 'evt_test_123',
    object: 'event',
    type: overrides.type,
    data: {
      object: {
        id: overrides.subscriptionId ?? 'sub_test_123',
        object: 'subscription',
        status: overrides.status,
        customer: overrides.stripeCustomerId ?? 'cus_test_123',
        metadata: overrides.firebaseUid ? { firebase_uid: overrides.firebaseUid } : {},
      },
    },
  });
}

function signPayload(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET });
}

function makeWebhookRequest(payload: string, signatureHeader: string | null): Request {
  const headers: Record<string, string> = {};
  if (signatureHeader !== null) {
    headers['stripe-signature'] = signatureHeader;
  }
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body: payload,
  });
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_used_for_network_calls';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_SECRET_KEY;
  });

  // (e) existing signature-verification-mandatory tests continue to pass
  // unmodified in spirit — rebuilt against a subscription-event payload
  // since checkout.session.completed no longer exists as a handled case,
  // but proving the exact same property: no valid signature, no DB write.
  it('rejects (400) a subscription event payload with a missing signature header, and never updates any user row', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionEventPayload({
      type: 'customer.subscription.created',
      firebaseUid: 'renter-uid-1',
      status: 'active',
    });
    const response = await POST(makeWebhookRequest(payload, null));

    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects (400) a subscription event payload with an invalid/tampered signature, and never updates any user row', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionEventPayload({
      type: 'customer.subscription.created',
      firebaseUid: 'renter-uid-1',
      status: 'active',
    });
    // Valid signature shape, but signed with the WRONG secret — simulates
    // an attacker forging a Stripe-Signature header without knowing the
    // real webhook secret.
    const wrongSecretSignature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_a_completely_different_secret',
    });
    const response = await POST(makeWebhookRequest(payload, wrongSecretSignature));

    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects (400) a payload whose body was tampered with after signing, even with an otherwise well-formed signature header', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const originalPayload = buildSubscriptionEventPayload({
      type: 'customer.subscription.created',
      firebaseUid: 'renter-uid-1',
      status: 'active',
    });
    const signatureForOriginalPayload = signPayload(originalPayload);
    // Attacker swaps in a different payload after the signature was
    // computed (e.g. trying to attach a different firebase_uid to a
    // captured, validly-signed envelope).
    const tamperedPayload = buildSubscriptionEventPayload({
      type: 'customer.subscription.created',
      firebaseUid: 'attacker-uid',
      status: 'active',
    });
    const response = await POST(makeWebhookRequest(tamperedPayload, signatureForOriginalPayload));

    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  // (a) customer.subscription.created with status: 'active' and a
  // resolvable firebase_uid -> tier updated to 'premium'.
  it('accepts a validly-signed customer.subscription.created event with status active and updates the corresponding user to tier=premium', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionEventPayload({
      type: 'customer.subscription.created',
      firebaseUid: 'renter-uid-1',
      status: 'active',
      stripeCustomerId: 'cus_test_abc',
    });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sqlText, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sqlText).toMatch(/UPDATE users/);
    expect(sqlText).not.toMatch(/INSERT/i);
    expect(sqlText).toMatch(/WHERE firebase_uid = \$4/);
    expect(params).toEqual(['premium', 'cus_test_abc', null, 'renter-uid-1']);
  });

  // (b) customer.subscription.created with status: 'incomplete' -> tier NOT
  // updated (proving the status check actually gates the grant, not just
  // the event type).
  it('does NOT update tier when a validly-signed customer.subscription.created event has status incomplete', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionEventPayload({
      type: 'customer.subscription.created',
      firebaseUid: 'renter-uid-1',
      status: 'incomplete',
    });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does NOT update tier when a validly-signed customer.subscription.updated event has status past_due', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionEventPayload({
      type: 'customer.subscription.updated',
      firebaseUid: 'renter-uid-1',
      status: 'past_due',
    });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
  });

  // (c) customer.subscription.updated fired a second time with status:
  // 'active' (simulating a renewal) after tier is already 'premium' -> no
  // error, idempotent no-op result (UPDATE both times, never INSERT).
  it('is idempotent: customer.subscription.updated firing again with status active (e.g. a renewal) after tier is already premium runs UPDATE both times without error', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const createdPayload = buildSubscriptionEventPayload({
      type: 'customer.subscription.created',
      firebaseUid: 'renter-uid-1',
      status: 'active',
      eventId: 'evt_test_created',
    });
    const renewalPayload = buildSubscriptionEventPayload({
      type: 'customer.subscription.updated',
      firebaseUid: 'renter-uid-1',
      status: 'active',
      eventId: 'evt_test_renewal',
    });

    const firstResponse = await POST(makeWebhookRequest(createdPayload, signPayload(createdPayload)));
    const secondResponse = await POST(makeWebhookRequest(renewalPayload, signPayload(renewalPayload)));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const call of queryMock.mock.calls) {
      const [sqlText, params] = call as [string, unknown[]];
      expect(sqlText).toMatch(/UPDATE users/);
      expect(sqlText).not.toMatch(/INSERT/i);
      expect(params).toEqual(['premium', 'cus_test_123', null, 'renter-uid-1']);
    }
  });

  it('does not create a speculative row and logs an anomaly when a subscription event cannot be resolved to any known firebase_uid', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionEventPayload({ type: 'customer.subscription.created', status: 'active' });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // (d) customer.subscription.deleted still reverts tier to 'free',
  // unchanged from spec 016.
  it('reverts tier to free on a validly-signed customer.subscription.deleted event, rather than leaving it stale at premium', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionEventPayload({
      type: 'customer.subscription.deleted',
      firebaseUid: 'renter-uid-1',
    });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    const [sqlText, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sqlText).toMatch(/UPDATE users/);
    expect(params).toEqual(['free', null, null, 'renter-uid-1']);
  });

  it('acknowledges (200) an unhandled-but-valid event type without touching the database', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = JSON.stringify({
      id: 'evt_test_789',
      object: 'event',
      type: 'invoice.paid',
      data: { object: { id: 'in_test_789', object: 'invoice' } },
    });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
  });

  // Regression guard for spec 023's own correction: checkout.session.completed
  // is no longer a handled case at all (handleCheckoutSessionCompleted was
  // removed, not left dead-but-reachable) — a validly-signed event of that
  // type must be acknowledged (200) but never write tier, same as any other
  // unhandled event type.
  it('acknowledges (200) a validly-signed checkout.session.completed event without touching the database, since that handler no longer exists (spec 023 correction)', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = JSON.stringify({
      id: 'evt_test_checkout_dead',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_dead',
          object: 'checkout.session',
          client_reference_id: 'renter-uid-1',
          customer: 'cus_test_123',
          metadata: { firebase_uid: 'renter-uid-1' },
        },
      },
    });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
