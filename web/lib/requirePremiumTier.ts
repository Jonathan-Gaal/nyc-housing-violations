// requirePremiumTier() (spec 020) — a strict superset of
// verifySessionCookie()'s pattern (web/lib/firebaseAdmin.ts): read cookie ->
// cryptographic verify -> derive UID -> + one more deterministic step, a DB
// tier lookup -> only then authorize. Not a divergent new pattern; this
// project's non-negotiable invariant ("a route must never trust a cookie's
// presence alone") applied one level further ("a route must also never
// trust a verified-but-wrong-tier user for a premium-gated resource").
//
// Returns a discriminated union so callers can distinguish "not logged in"
// (401, "sign in") from "logged in but free tier" (403, "upgrade to
// premium") — the two need different client-side messaging.
import { cookies } from 'next/headers';
import { getPool } from '@/lib/pgClient';
import { verifySessionCookie } from '@/lib/firebaseAdmin';
import { SESSION_COOKIE_NAME } from '@/app/api/auth/session/route';

export type RequirePremiumTierResult =
  | { authorized: true; uid: string; email: string }
  | { authorized: false; reason: 'unauthenticated' | 'not-premium' };

interface TierLookupRow {
  firebase_uid: string;
  email: string;
  tier: string;
}

async function findUserTier(firebaseUid: string): Promise<TierLookupRow | null> {
  const pool = getPool();
  const result = await pool.query<TierLookupRow>(
    'SELECT firebase_uid, email, tier FROM users WHERE firebase_uid = $1',
    [firebaseUid]
  );
  return result.rows[0] ?? null;
}

export async function requirePremiumTier(): Promise<RequirePremiumTierResult> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie || sessionCookie.value.trim().length === 0) {
    return { authorized: false, reason: 'unauthenticated' };
  }

  // Cryptographic verification happens before any DB call — a tampered,
  // forged, or expired cookie value throws here and never reaches
  // findUserTier, matching app/api/auth/me/route.ts's pattern exactly.
  let verifiedFirebaseUid: string;
  try {
    const decodedSessionCookie = await verifySessionCookie(sessionCookie.value);
    verifiedFirebaseUid = decodedSessionCookie.uid;
  } catch {
    return { authorized: false, reason: 'unauthenticated' };
  }

  // A verified UID with no matching users row (shouldn't happen for a real
  // signed-in user, but defensively — spec 020 Edge Cases) is treated as
  // not-premium/unauthorized, never a crash.
  const userRow = await findUserTier(verifiedFirebaseUid);
  if (!userRow || userRow.tier !== 'premium') {
    return { authorized: false, reason: 'not-premium' };
  }

  return { authorized: true, uid: userRow.firebase_uid, email: userRow.email };
}
