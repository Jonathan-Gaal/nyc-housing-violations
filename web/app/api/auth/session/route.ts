// Session-exchange route (spec 015). The client sends a freshly-obtained
// Firebase ID token here exactly once, over HTTPS, in the request body. The
// server verifies it (Phase 11's verifyIdToken), upserts the corresponding
// `users` row, and sets an HttpOnly/Secure/SameSite=Strict session cookie.
// The raw Firebase ID token is never echoed back to the client and never
// persisted anywhere client-readable — see spec 015's Objective for the
// localStorage-pattern correction this route implements instead of.
//
// Mode-2 correction (ratchet): the cookie's value MUST be a cryptographically
// signed session cookie produced by Firebase Admin SDK's own
// createSessionCookie() — never the raw, unsigned Firebase UID. An unsigned
// UID string is trivially forgeable by any client (`Cookie: session=<any-uid>`)
// since nothing downstream re-verified it. createSessionCookie()/
// verifySessionCookie() (lib/firebaseAdmin.ts) close that gap.
import { getPool } from '@/lib/pgClient';
import { verifyIdToken, createSessionCookie } from '@/lib/firebaseAdmin';

// Name is intentionally generic — never named after the raw Firebase token
// (spec 015 Naming Constraints) since this cookie's value is a
// server-signed session cookie, not the raw token itself.
export const SESSION_COOKIE_NAME = 'session';

// Session length: 5 days. Also passed to createSessionCookie's expiresIn,
// so the cookie's Max-Age and the signed cookie's own embedded expiry agree
// (Firebase caps expiresIn at 14 days; 5 days stays well within that).
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;
const SESSION_MAX_AGE_MILLISECONDS = SESSION_MAX_AGE_SECONDS * 1000;

export interface SessionRequestBody {
  idToken: string;
}

interface SessionUserRow {
  firebase_uid: string;
  email: string;
  tier: string;
}

async function upsertUser(firebaseUid: string, email: string): Promise<SessionUserRow> {
  const pool = getPool();
  const result = await pool.query<SessionUserRow>(
    `INSERT INTO users (firebase_uid, email, last_login)
     VALUES ($1, $2, NOW())
     ON CONFLICT (firebase_uid) DO UPDATE SET last_login = NOW(), email = EXCLUDED.email
     RETURNING firebase_uid, email, tier`,
    [firebaseUid, email]
  );
  const userRow = result.rows[0];
  if (!userRow) {
    throw new Error('User upsert did not return a row');
  }
  return userRow;
}

function isSessionRequestBody(value: unknown): value is SessionRequestBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'idToken' in value &&
    typeof (value as { idToken: unknown }).idToken === 'string' &&
    (value as { idToken: string }).idToken.trim().length > 0
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!isSessionRequestBody(body)) {
    return Response.json({ error: 'idToken is required' }, { status: 400 });
  }

  let decodedToken;
  try {
    decodedToken = await verifyIdToken(body.idToken);
  } catch {
    // Tampered/expired/malformed token: 401, no cookie set, no user upsert.
    return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  if (!decodedToken.email) {
    return Response.json({ error: 'Token is missing an email claim' }, { status: 401 });
  }

  let userRow: SessionUserRow;
  try {
    userRow = await upsertUser(decodedToken.uid, decodedToken.email);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  // The session cookie's value is a cryptographically signed session cookie
  // (Firebase Admin SDK's createSessionCookie), never the raw ID token or a
  // raw unsigned UID. httpOnly prevents any client-side JS from reading it;
  // secure restricts it to HTTPS; sameSite=strict provides CSRF mitigation
  // for this spec's scope (see spec 015 Security Constraints).
  let cookieValue: string;
  try {
    cookieValue = await createSessionCookie(body.idToken, SESSION_MAX_AGE_MILLISECONDS);
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  const setCookieHeader = [
    `${SESSION_COOKIE_NAME}=${cookieValue}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');

  return Response.json(
    { uid: userRow.firebase_uid, email: userRow.email, tier: userRow.tier },
    { status: 200, headers: { 'Set-Cookie': setCookieHeader } }
  );
}
