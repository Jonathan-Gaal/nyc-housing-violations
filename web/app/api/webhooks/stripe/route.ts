// Stripe webhook handler (spec 016, corrected by spec 023) — the actual
// source of truth for tier changes. A signature-verified event is the only
// thing this route ever trusts; client-reported "payment succeeded" signals
// (e.g. from the /upgrade route's own response) are never sufficient to
// flip users.tier. See spec 016's Design Pattern (webhook-as-source-of-truth)
// and Intellectual Control note: an attacker POSTing a fake webhook payload
// directly to this route, without a valid Stripe-Signature header, must
// never be able to grant free premium access — that is the single most
// important property this file has to prove, not just claim (spec 016
// Security Constraints).
//
// Spec 023 correction: spec 022 replaced the Checkout-redirect flow with an
// in-app subscription created directly via stripeClient.subscriptions.create
// (payment_behavior: 'default_incomplete') — checkout.session.completed is
// Checkout-only and NEVER fires for that flow. The correct events, verified
// against Stripe's own Elements + PaymentIntents subscription-integration
// guide, are customer.subscription.created/.updated, gated on
// status === 'active' (a default_incomplete subscription starts 'incomplete'
// and transitions to 'active' only once the initial PaymentIntent confirms —
// the event *type* firing is not itself proof payment succeeded; the
// *status* field is). handleCheckoutSessionCompleted is removed entirely
// (not left dead-but-reachable) since checkout.session.completed will never
// fire in this app's actual usage going forward.
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

// Handles customer.subscription.created and customer.subscription.updated
// (spec 023) — both routed here since either can carry the transition into
// status: 'active'. Only grants premium when status has actually reached
// 'active'; any other status (e.g. 'incomplete', 'past_due') is a no-op on
// this event, matching spec 023's Edge Cases (a failed/pending renewal is
// not a revocation — customer.subscription.deleted remains the only
// revocation trigger). setUserTier()'s existing idempotency (UPDATE keyed
// on firebase_uid) is required here specifically because .updated fires on
// every subsequent lifecycle change too (renewals, plan changes), not just
// the initial activation — this handler must tolerate being called many
// times over a subscription's life and produce the same no-op result once
// tier is already 'premium'.
async function handleSubscriptionActivated(subscription: Stripe.Subscription): Promise<void> {
  const firebaseUid = extractFirebaseUid(subscription);
  if (!firebaseUid) {
    // Defensive edge case (spec 023 Edge Cases): shouldn't happen given
    // spec 022 always sets metadata.firebase_uid on subscription creation,
    // but a webhook we cannot resolve to a known user is logged as an
    // anomaly, not silently dropped and not used to speculatively write a row.
    console.error('stripe webhook: subscription event with no resolvable firebase_uid', {
      subscriptionId: subscription.id,
    });
    return;
  }

  if (subscription.status !== 'active') {
    // Not every .created/.updated event means "grant premium" — only the
    // one(s) where status has actually reached 'active' (spec 023 Design
    // Pattern: status-checked, not just event-type-trusted).
    return;
  }

  const stripeCustomerId =
    typeof subscription.customer === 'string' ? subscription.customer : (subscription.customer?.id ?? null);
  const rowsUpdated = await setUserTier(firebaseUid, 'premium', stripeCustomerId, null);
  if (rowsUpdated === 0) {
    console.error('stripe webhook: subscription activated for unknown firebase_uid', { firebaseUid });
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
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionActivated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        // Other event types are acknowledged but not acted on — not an error.
        break;
    }
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  return Response.json({ received: true }, { status: 200 });
}
