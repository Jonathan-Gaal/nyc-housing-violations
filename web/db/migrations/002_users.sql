-- Firebase Auth foundation (Phase 11, spec 014). users table shape per
-- product-spec §5.1. stripe_customer_id/subscription_expires exist here but
-- are not populated or read by any code until Phase 13 (Stripe, spec 016).

CREATE TABLE IF NOT EXISTS users (
  firebase_uid TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  subscription_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ
);
