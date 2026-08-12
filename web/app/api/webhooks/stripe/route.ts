// Stripe webhook handler (spec 016) — the actual source of truth for tier
// changes. A signature-verified event is the only thing this route ever
// trusts; client-reported "payment succeeded" signals (e.g. from the
// /upgrade route's own response) are never sufficient to flip
// users.tier. See spec 016's Design Pattern (webhook-as-source-of-truth)
// and Intellectual Control note: an attacker POSTing a fake
// checkout.session.completed payload directly to this route, without a
// valid Stripe-Signature header, must never be able to grant free premium
// access — that is the single most important property this file has to
// prove, not just claim (spec 016 Security Constraints).
import type Stripe from 'stripe';
import { getPool } from '@/lib/pgClient';
import { getStripeClient } from '@/lib/stripe';

function assertValidWebhookSecret(webhookSecret: string | undefined): asserts webhookSecret is string {
  if (!webhookSecret || webhookSecret.trim().length === 0) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set. Add it to web/.env.local using the signing secret from ' +
        'your Stripe webhook endpoint configuration — see web/.env.example for the shape.'
    );
  }
}

// Idempotent by design (Stripe's documented at-least-once delivery
// guarantee, spec 016 Edge Cases): an UPDATE keyed on firebase_uid is safe
// to run twice with the same result, unlike an INSERT that would fail (or
// duplicate a row) on redelivery.
async function setUserTier(
  firebaseUid: string,
  tier: 'premium' | 'free',
  stripeCustomerId: string | null,
  subscriptionExpires: Date | null
): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE users
     SET tier = $1,
         stripe_customer_id = COALESCE($2, stripe_customer_id),
         subscription_expires = $3
     WHERE firebase_uid = $4`,
    [tier, stripeCustomerId, subscriptionExpires, firebaseUid]
  );
  return result.rowCount ?? 0;
}

function extractFirebaseUid(
  metadataSource: { metadata?: Stripe.Metadata | null } | null | undefined
): string | null {
  const firebaseUid = metadataSource?.metadata?.firebase_uid;
  return typeof firebaseUid === 'string' && firebaseUid.trim().length > 0 ? firebaseUid : null;
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const firebaseUid = extractFirebaseUid(session) ?? session.client_reference_id;
  if (!firebaseUid) {
    // Defensive edge case (spec 016 Edge Cases): a webhook we cannot
    // resolve to a known user is logged as an anomaly, not silently
    // dropped and not used to speculatively create a row.
    console.error('stripe webhook: checkout.session.completed with no resolvable firebase_uid', {
      sessionId: session.id,
    });
    return;
  }

  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
  const rowsUpdated = await setUserTier(firebaseUid, 'premium', stripeCustomerId, null);
  if (rowsUpdated === 0) {
    console.error('stripe webhook: checkout.session.completed for unknown firebase_uid', { firebaseUid });
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const firebaseUid = extractFirebaseUid(subscription);
  if (!firebaseUid) {
    console.error('stripe webhook: customer.subscription.deleted with no resolvable firebase_uid', {
      subscriptionId: subscription.id,
    });
    return;
  }

  // Cancellation/expiration reverts tier to 'free' rather than leaving it
  // stale at 'premium' (spec 016 Edge Cases).
  const rowsUpdated = await setUserTier(firebaseUid, 'free', null, null);
  if (rowsUpdated === 0) {
    console.error('stripe webhook: customer.subscription.deleted for unknown firebase_uid', { firebaseUid });
  }
}

export async function POST(request: Request): Promise<Response> {
  const signatureHeader = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  assertValidWebhookSecret(process.env.STRIPE_WEBHOOK_SECRET);

  if (!signatureHeader) {
    // No signature at all — rejected before ever touching Stripe's SDK or
    // the database. This is the critical assertion from spec 016's
    // Verification Oracle: an unsigned payload must never update a row.
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const stripeClient = getStripeClient();
  let event: Stripe.Event;
  try {
    event = await stripeClient.webhooks.constructEventAsync(
      rawBody,
      signatureHeader,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    // Invalid/tampered signature — rejected, no DB write. constructEventAsync
    // throws Stripe.errors.StripeSignatureVerificationError for any mismatch.
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        // Other event types (e.g. customer.subscription.updated) are
        // acknowledged but not acted on yet — not an error.
        break;
    }
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  return Response.json({ received: true }, { status: 200 });
}
