// Initiates an in-app Stripe subscription/PaymentIntent for the
// authenticated user's premium upgrade (spec 022, replacing spec 016's
// Checkout-redirect flow — see spec 022's "Scoped reversal" note: this is a
// deliberate reversal of the redirect-vs-embed choice only, not of the
// PCI-scope-minimization property that motivated it, since Stripe's Payment
// Element is still a PCI-SAQ-A-eligible Stripe-hosted-iframe component).
// Requires a verified session cookie — this route never trusts
// middleware's presence-only cookie check (see middleware.ts's own
// SECURITY BOUNDARY NOTE) and never itself writes `users.tier`; only the
// signature-verified webhook handler (app/api/webhooks/stripe/route.ts)
// does that, once Stripe confirms payment. See spec 016's Design Pattern
// (webhook-as-source-of-truth) and Amendment note (explicit handler-side
// verifySessionCookie() is mandatory, matching app/api/auth/me/route.ts's
// existing pattern exactly) — both unchanged by this spec.
import type Stripe from 'stripe';
import { cookies } from 'next/headers';
import { getPool } from '@/lib/pgClient';
import { verifySessionCookie } from '@/lib/firebaseAdmin';
import { getStripeClient } from '@/lib/stripe';
import { SESSION_COOKIE_NAME } from '@/app/api/auth/session/route';

// Placeholder premium subscription price ($9.99/mo) — carried over from
// spec 016 unchanged; no real Stripe product/price is configured yet for
// the premium tier.
const PREMIUM_SUBSCRIPTION_PRICE_CENTS = 999;

// A distinct, searchable name for the premium-tier Stripe Product, used
// only to find-or-create it below.
const PREMIUM_PRODUCT_NAME = 'HomeCheck NYC Premium Tier';

// Fixed, deterministic Stripe object ID for the premium-tier Product —
// Subscription creation's price_data (unlike Checkout Session's price_data)
// requires a real, pre-existing Product ID; it has no inline product_data
// escape hatch the way Checkout's price_data does. Using an explicit `id`
// on products.create (Stripe allows a caller-supplied Product ID) rather
// than searching-then-creating avoids Stripe's Search API's documented
// eventual-consistency window ("data is searchable in less than a minute,"
// per Stripe's own docs) — a search immediately after a first create could
// find nothing and create a duplicate product under load. Creating against
// a fixed ID and treating "already exists" as success is idempotent and
// strictly consistent, no search required.
const PREMIUM_PRODUCT_ID = 'homecheck-nyc-premium-tier';

async function findOrCreatePremiumProductId(stripeClient: Stripe): Promise<string> {
  try {
    const existingProduct = await stripeClient.products.retrieve(PREMIUM_PRODUCT_ID);
    return existingProduct.id;
  } catch {
    // Not found (or any other retrieve error) — attempt to create it.
    // A `resource_already_exists`-shaped error from a racing concurrent
    // request is treated as success (the product exists either way), not
    // a failure — same idempotent-write posture as this codebase's other
    // ON CONFLICT DO NOTHING-style writes (webhooks/stripe/route.ts,
    // lib/favorites.ts's addFavorite).
    try {
      const createdProduct = await stripeClient.products.create({
        id: PREMIUM_PRODUCT_ID,
        name: PREMIUM_PRODUCT_NAME,
      });
      return createdProduct.id;
    } catch {
      return PREMIUM_PRODUCT_ID;
    }
  }
}

interface UpgradeUserRow {
  firebase_uid: string;
  email: string;
  stripe_customer_id: string | null;
}

async function findUserForUpgrade(firebaseUid: string): Promise<UpgradeUserRow | null> {
  const pool = getPool();
  const result = await pool.query<UpgradeUserRow>(
    'SELECT firebase_uid, email, stripe_customer_id FROM users WHERE firebase_uid = $1',
    [firebaseUid]
  );
  return result.rows[0] ?? null;
}

// Persists a newly-created Stripe customer id against the user's row. This
// is the only DB write this route performs — it never writes `tier`, per
// spec 016's Design Pattern (webhook-as-source-of-truth for payment state).
async function saveStripeCustomerId(firebaseUid: string, stripeCustomerId: string): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE firebase_uid = $2', [
    stripeCustomerId,
    firebaseUid,
  ]);
}

export async function POST() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie || sessionCookie.value.trim().length === 0) {
    // No Stripe client is ever constructed/called on this path — the
    // identity check happens strictly before any Stripe interaction, per
    // spec 016's Verification Oracle (c).
    return Response.json({ authenticated: false }, { status: 401 });
  }

  // Cryptographic verification happens before any Stripe or DB call — a
  // tampered, forged, or expired cookie value throws here and never
  // reaches Stripe, matching app/api/auth/me/route.ts's pattern exactly
  // (spec 016 Amendment note: middleware's presence-only check does not
  // satisfy this requirement on its own).
  let verifiedFirebaseUid: string;
  try {
    const decodedSessionCookie = await verifySessionCookie(sessionCookie.value);
    verifiedFirebaseUid = decodedSessionCookie.uid;
  } catch {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  let userRow: UpgradeUserRow | null;
  try {
    userRow = await findUserForUpgrade(verifiedFirebaseUid);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!userRow) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  const stripeClient = getStripeClient();

  try {
    // Reuse an existing Stripe customer if this user already has one
    // (e.g. a prior lapsed/cancelled subscription), otherwise create one
    // tied to their firebase_uid via metadata — the webhook handler uses
    // this metadata to resolve which user a payment event belongs to.
    let stripeCustomerId = userRow.stripe_customer_id;
    if (!stripeCustomerId) {
      const stripeCustomer = await stripeClient.customers.create({
        email: userRow.email,
        metadata: { firebase_uid: userRow.firebase_uid },
      });
      stripeCustomerId = stripeCustomer.id;
      await saveStripeCustomerId(userRow.firebase_uid, stripeCustomerId);
    }

    const premiumProductId = await findOrCreatePremiumProductId(stripeClient);

    // In-app Payment Element flow (spec 022, replacing spec 016's Checkout
    // redirect): payment_behavior: 'default_incomplete' creates the
    // subscription in an incomplete state and its first invoice's
    // PaymentIntent unconfirmed, so the client can confirm it in-app via
    // Stripe.js against the returned clientSecret — the browser never
    // navigates to a stripe.com-hosted page. price_data defines the
    // premium subscription price inline against the find-or-created
    // product above rather than requiring a pre-configured Stripe Price
    // ID/extra env var — this project's env var list is unchanged:
    // STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and
    // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. metadata.firebase_uid on the
    // subscription itself (not just the customer) is required so
    // customer.subscription.deleted webhook events can resolve which user
    // to revert to tier='free' on cancellation (same reasoning as spec
    // 016's post-commit subscription_data.metadata fix, applied directly
    // here since subscriptions.create sets metadata on the Subscription
    // object itself, with no separate subscription_data wrapper needed).
    const subscription = await stripeClient.subscriptions.create({
      customer: stripeCustomerId,
      items: [
        {
          price_data: {
            currency: 'usd',
            product: premiumProductId,
            unit_amount: PREMIUM_SUBSCRIPTION_PRICE_CENTS,
            recurring: { interval: 'month' },
          },
        },
      ],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      metadata: { firebase_uid: userRow.firebase_uid },
    });

    const latestInvoice = subscription.latest_invoice as Stripe.Invoice & {
      payment_intent?: Stripe.PaymentIntent | string | null;
    };
    const paymentIntent =
      typeof latestInvoice?.payment_intent === 'object' ? latestInvoice.payment_intent : null;
    const clientSecret = paymentIntent?.client_secret;

    if (!clientSecret) {
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }

    // This response never sets tier itself — only { clientSecret } is
    // returned. users.tier is exclusively the webhook handler's
    // responsibility once Stripe confirms payment (unchanged invariant
    // from spec 016, re-tested here since this is the piece most at risk
    // of regressing it — see spec 022's Intellectual Control note).
    return Response.json({ clientSecret }, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
