// Client-side Stripe.js singleton (spec 022). Named getStripeJsPromise() —
// not getStripeClient(), which is the existing server-side singleton in
// lib/stripe.ts — to disambiguate by filename and function name both
// (Naming Constraints). Mirrors the getXxx() lazy-singleton shape used
// throughout this codebase (getPool, getFirebaseAdmin, getStripeClient).
//
// Client-only: loadStripe() from @stripe/stripe-js must never be imported
// from a server-only module. NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is
// client-exposed by Stripe's own SDK design (already documented as
// safe-to-expose in web/.env.example, unused until this spec) — not a new
// secret-handling risk.
import { loadStripe, type Stripe } from '@stripe/stripe-js';

let _stripeJsPromise: Promise<Stripe | null> | null = null;

export function getStripeJsPromise(): Promise<Stripe | null> {
  if (!_stripeJsPromise) {
    _stripeJsPromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '');
  }
  return _stripeJsPromise;
}
