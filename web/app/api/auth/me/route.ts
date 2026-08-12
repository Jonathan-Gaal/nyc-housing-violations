// Reads the HttpOnly session cookie server-side (never client-readable) and
// returns the signed-in user's profile. useAuth.ts (client) calls this
// route to learn auth state instead of ever inspecting document.cookie —
// see spec 015 Constraints.
//
// Mode-2 correction (ratchet): the cookie's string value is untrusted input
// until cryptographically verified — middleware.ts only checks *presence*
// (an Edge-runtime constraint, not the security boundary; see middleware.ts
// comment). This route is the actual boundary: it must call
// verifySessionCookie() and derive the UID from the verified, decoded
// result before ever touching the database. A raw DB lookup keyed directly
// on the cookie's string value (the original, incorrect implementation)
// would let any client forge authentication with
// `Cookie: session=<arbitrary-string>`.
import { cookies } from 'next/headers';
import { getPool } from '@/lib/pgClient';
import { verifySessionCookie } from '@/lib/firebaseAdmin';
import { SESSION_COOKIE_NAME } from '@/app/api/auth/session/route';

export interface AuthenticatedUserProfile {
  uid: string;
  email: string;
  tier: string;
}

interface UserProfileRow {
  firebase_uid: string;
  email: string;
  tier: string;
}

async function findUserByFirebaseUid(firebaseUid: string): Promise<UserProfileRow | null> {
  const pool = getPool();
  const result = await pool.query<UserProfileRow>(
    'SELECT firebase_uid, email, tier FROM users WHERE firebase_uid = $1',
    [firebaseUid]
  );
  return result.rows[0] ?? null;
}

export async function GET() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!sessionCookie || sessionCookie.value.trim().length === 0) {
    // 401 with an explicit shape, not a 500 — lets useAuth.ts distinguish
    // "not logged in" from a genuine server error (spec 015 Edge Cases).
    return Response.json({ authenticated: false }, { status: 401 });
  }

  // Cryptographic verification happens before any DB lookup. A tampered,
  // forged, or expired cookie value throws here and never reaches
  // findUserByFirebaseUid — it is rejected outright, matching
  // verifyIdToken's own "never a falsy-but-truthy fallback" contract.
  let verifiedFirebaseUid: string;
  try {
    const decodedSessionCookie = await verifySessionCookie(sessionCookie.value);
    verifiedFirebaseUid = decodedSessionCookie.uid;
  } catch {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  let userRow: UserProfileRow | null;
  try {
    userRow = await findUserByFirebaseUid(verifiedFirebaseUid);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!userRow) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  const profile: AuthenticatedUserProfile = {
    uid: userRow.firebase_uid,
    email: userRow.email,
    tier: userRow.tier,
  };
  return Response.json(profile, { status: 200 });
}
