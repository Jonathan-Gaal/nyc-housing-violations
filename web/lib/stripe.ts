import Stripe from 'stripe';

// Server-only Stripe SDK singleton. Never import this file from a Client
// Component — STRIPE_SECRET_KEY must never reach the browser bundle. Mirrors
// pgClient.ts's getPool() / firebaseAdmin.ts's getFirebaseAdmin() lazy-
// singleton, fail-fast shape (spec 016 Naming Constraints:
// getStripeClient()).

// Substrings that indicate the env var still holds the documented
// placeholder from .env.example rather than a real Stripe secret key.
const PLACEHOLDER_MARKERS = ['YOUR-', '[', ']'];

// Shared placeholder-detection logic, exported so test suites (and the
// credential-blocked integration test, per spec 016) can decide whether to
// skip tests that require a real Stripe account rather than fail against a
// placeholder credential.
export function isStripeSecretKeyPlaceholder(stripeSecretKey: string | undefined): boolean {
  if (!stripeSecretKey || stripeSecretKey.trim().length === 0) return true;
  return PLACEHOLDER_MARKERS.some((marker) => stripeSecretKey.includes(marker));
}

function assertValidStripeSecretKey(stripeSecretKey: string | undefined): asserts stripeSecretKey is string {
  if (!stripeSecretKey || stripeSecretKey.trim().length === 0) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add it to web/.env.local using your Stripe test-mode secret ' +
        'key (starts with sk_test_) — see web/.env.example for the shape.'
    );
  }

  if (isStripeSecretKeyPlaceholder(stripeSecretKey)) {
    throw new Error(
      'STRIPE_SECRET_KEY still contains the placeholder value from web/.env.example. ' +
        'Replace it with your real Stripe secret key before running this.'
    );
  }
}

let _stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (_stripeClient) return _stripeClient;

  assertValidStripeSecretKey(process.env.STRIPE_SECRET_KEY);
  _stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);

  return _stripeClient;
}
