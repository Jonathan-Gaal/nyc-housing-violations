import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

// spec 016's declared Verification Oracle file. Uses Stripe's own
// documented test-mode webhook signing utility
// (Stripe.webhooks.generateTestHeaderString) to produce a genuine HMAC
// signature against a known test secret — this is fully offline-testable
// and does not require a live Stripe account or test-mode keys (per the
// spec's own credential-blocked-pattern design). The signature-verification
// step itself is never mocked: this is the file proving the single most
// important security property in this spec (Intellectual Control) — an
// attacker POSTing a fake checkout.session.completed payload without a
// valid signature must never be able to grant free premium access.

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_only';
const ORIGINAL_STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ORIGINAL_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

function buildCheckoutSessionCompletedPayload(overrides: {
  firebaseUid?: string;
  clientReferenceId?: string | null;
  stripeCustomerId?: string | null;
}) {
  return JSON.stringify({
    id: 'evt_test_123',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        object: 'checkout.session',
        client_reference_id: overrides.clientReferenceId ?? null,
        customer: overrides.stripeCustomerId ?? 'cus_test_123',
        metadata: overrides.firebaseUid ? { firebase_uid: overrides.firebaseUid } : {},
      },
    },
  });
}

function buildSubscriptionDeletedPayload(overrides: { firebaseUid?: string }) {
  return JSON.stringify({
    id: 'evt_test_456',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_test_456',
        object: 'subscription',
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

  it('rejects (400) a checkout.session.completed payload with a missing signature header, and never updates any user row', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildCheckoutSessionCompletedPayload({ firebaseUid: 'renter-uid-1' });
    const response = await POST(makeWebhookRequest(payload, null));

    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects (400) a checkout.session.completed payload with an invalid/tampered signature, and never updates any user row', async () => {
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildCheckoutSessionCompletedPayload({ firebaseUid: 'renter-uid-1' });
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
    const originalPayload = buildCheckoutSessionCompletedPayload({ firebaseUid: 'renter-uid-1' });
    const signatureForOriginalPayload = signPayload(originalPayload);
    // Attacker swaps in a different payload after the signature was
    // computed (e.g. trying to attach a different firebase_uid to a
    // captured, validly-signed envelope).
    const tamperedPayload = buildCheckoutSessionCompletedPayload({ firebaseUid: 'attacker-uid' });
    const response = await POST(makeWebhookRequest(tamperedPayload, signatureForOriginalPayload));

    expect(response.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts a validly-signed checkout.session.completed event and updates the corresponding user to tier=premium', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildCheckoutSessionCompletedPayload({
      firebaseUid: 'renter-uid-1',
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

  it('falls back to client_reference_id to resolve the user when metadata.firebase_uid is absent', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildCheckoutSessionCompletedPayload({ clientReferenceId: 'renter-uid-2' });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    const [, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['premium', 'cus_test_123', null, 'renter-uid-2']);
  });

  it('does not create a speculative row and logs an anomaly when the event cannot be resolved to any known firebase_uid', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryMock = vi.fn();
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildCheckoutSessionCompletedPayload({});
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('is idempotent: delivering the same validly-signed event twice runs UPDATE (not INSERT) both times, safe under Stripe at-least-once delivery', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildCheckoutSessionCompletedPayload({ firebaseUid: 'renter-uid-1' });
    const signature = signPayload(payload);

    const firstResponse = await POST(makeWebhookRequest(payload, signature));
    const secondResponse = await POST(makeWebhookRequest(payload, signature));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const call of queryMock.mock.calls) {
      const [sqlText] = call as [string, unknown[]];
      expect(sqlText).toMatch(/UPDATE users/);
      expect(sqlText).not.toMatch(/INSERT/i);
    }
  });

  it('reverts tier to free on a validly-signed customer.subscription.deleted event, rather than leaving it stale at premium', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));

    const { POST } = await import('./route');
    const payload = buildSubscriptionDeletedPayload({ firebaseUid: 'renter-uid-1' });
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
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_test_789', object: 'subscription' } },
    });
    const response = await POST(makeWebhookRequest(payload, signPayload(payload)));

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
