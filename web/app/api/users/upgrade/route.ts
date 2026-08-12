// Initiates a Stripe Checkout session for the authenticated user's premium
// upgrade (spec 016). Requires a verified session cookie — this route never
// trusts middleware's presence-only cookie check (see middleware.ts's own
// SECURITY BOUNDARY NOTE) and never itself writes `users.tier`; only the
// signature-verified webhook handler (app/api/webhooks/stripe/route.ts)
// does that, once Stripe confirms payment. See spec 016's Design Pattern
// (webhook-as-source-of-truth) and Amendment note (explicit handler-side
// verifySessionCookie() is mandatory, matching app/api/auth/me/route.ts's
// existing pattern exactly).
import { cookies, headers } from 'next/headers';
import { getPool } from '@/lib/pgClient';
import { verifySessionCookie } from '@/lib/firebaseAdmin';
import { getStripeClient } from '@/lib/stripe';
import { SESSION_COOKIE_NAME } from '@/app/api/auth/session/route';

// Placeholder premium subscription price ($9.99/mo) — this spec builds tier
// infrastructure only, with no premium feature yet to gate (spec 016
// [FORCES] #4), so no product-defined price exists yet either. Revisit once
// a real Stripe product/price is configured for the premium tier.
const PREMIUM_SUBSCRIPTION_PRICE_CENTS = 999;

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

async function resolveOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  if (origin) return origin;
  const host = requestHeaders.get('host');
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  return `${protocol}://${host ?? 'localhost:3000'}`;
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
  const origin = await resolveOrigin();

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

    // Stripe Checkout (redirect-based) rather than a custom card form, per
    // spec 016 [FORCES] #3 — keeps raw card data off this app's servers
    // entirely (PCI-scope minimization). The `/upgrade` response only ever
    // returns a Checkout URL; it never itself confirms payment or writes
    // `tier`. price_data defines the premium subscription price inline
    // rather than requiring a pre-configured Stripe Price ID/extra env var
    // — spec 016's env var list is fixed at STRIPE_SECRET_KEY,
    // STRIPE_WEBHOOK_SECRET, and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
    const checkoutSession = await stripeClient.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      client_reference_id: userRow.firebase_uid,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Premium tier' },
            unit_amount: PREMIUM_SUBSCRIPTION_PRICE_CENTS,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/account?upgrade=success`,
      cancel_url: `${origin}/account?upgrade=cancelled`,
      metadata: { firebase_uid: userRow.firebase_uid },
      // Stripe does NOT copy a Checkout Session's own `metadata` onto the
      // Subscription object it creates for `mode: 'subscription'` sessions —
      // that only happens if `subscription_data.metadata` is explicitly set
      // here. Without this, `customer.subscription.deleted` webhook events
      // carry a Subscription with no `firebase_uid` in its metadata, so
      // handleSubscriptionDeleted() can never resolve which user to revert
      // to tier='free' on cancellation — a silent, permanent premium-access
      // leak, contradicting spec 016's Edge Cases section. This is the fix
      // for that defect (found post-commit by soundwave's risk assessment).
      subscription_data: { metadata: { firebase_uid: userRow.firebase_uid } },
    });

    if (!checkoutSession.url) {
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }

    return Response.json({ checkoutUrl: checkoutSession.url }, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
