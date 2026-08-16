// Favorites API (spec 019) — GET/POST/DELETE a signed-in user's saved
// buildings/landlord profiles. Single route, `type`-param dispatch (not
// /api/favorites/buildings + /api/favorites/landlords) to stay under this
// spec's file cap while covering both resource types.
//
// Every handler calls verifySessionCookie() itself — never relies on
// middleware.ts's presence-only check as the actual boundary. This is the
// same read-cookie-verify-derive-UID sequence as app/api/auth/me/route.ts
// and app/api/users/upgrade/route.ts (non-negotiable per this project's
// context packet: a favorites route that trusted middleware alone would
// repeat the Phase-12 auth-bypass class of bug already fixed once).
//
// The verified UID is the only source of "whose favorites" — firebase_uid
// is never accepted as a client-supplied body/query param, so one user can
// never read/write another user's favorites by passing an arbitrary UID.
import { cookies } from 'next/headers';
import { getPool } from '@/lib/pgClient';
import { verifySessionCookie } from '@/lib/firebaseAdmin';
import { SESSION_COOKIE_NAME } from '@/app/api/auth/session/route';
import {
  addFavorite,
  listFavoritesForUser,
  removeFavorite,
  type FavoriteResourceType,
} from '@/lib/favorites';

const ALLOWED_RESOURCE_TYPES: FavoriteResourceType[] = ['building', 'landlord'];

function isValidResourceType(value: unknown): value is FavoriteResourceType {
  return typeof value === 'string' && (ALLOWED_RESOURCE_TYPES as string[]).includes(value);
}

interface FavoriteRequestBody {
  type?: unknown;
  key?: unknown;
}

// Cryptographic verification happens before any DB call — a missing,
// tampered, forged, or expired cookie value returns null and the caller
// responds 401 without ever touching favorites.ts, matching
// app/api/auth/me/route.ts's pattern exactly.
async function requireVerifiedFirebaseUid(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie || sessionCookie.value.trim().length === 0) {
    return null;
  }
  try {
    const decodedSessionCookie = await verifySessionCookie(sessionCookie.value);
    return decodedSessionCookie.uid;
  } catch {
    return null;
  }
}

export async function GET() {
  const firebaseUid = await requireVerifiedFirebaseUid();
  if (!firebaseUid) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  try {
    const pool = getPool();
    const favorites = await listFavoritesForUser(pool, firebaseUid);
    return Response.json(favorites, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const firebaseUid = await requireVerifiedFirebaseUid();
  if (!firebaseUid) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  let body: FavoriteRequestBody;
  try {
    body = (await request.json()) as FavoriteRequestBody;
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  // Validated before touching SQL, consistent with this project's
  // zip-regex-before-SoQL invariant applied to this untrusted-input surface.
  if (!isValidResourceType(body.type) || typeof body.key !== 'string' || body.key.trim().length === 0) {
    return Response.json({ error: "type must be 'building' or 'landlord' and key must be a non-empty string" }, { status: 400 });
  }

  try {
    const pool = getPool();
    await addFavorite(pool, firebaseUid, body.type, body.key);
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const firebaseUid = await requireVerifiedFirebaseUid();
  if (!firebaseUid) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  let body: FavoriteRequestBody;
  try {
    body = (await request.json()) as FavoriteRequestBody;
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  if (!isValidResourceType(body.type) || typeof body.key !== 'string' || body.key.trim().length === 0) {
    return Response.json({ error: "type must be 'building' or 'landlord' and key must be a non-empty string" }, { status: 400 });
  }

  try {
    const pool = getPool();
    await removeFavorite(pool, firebaseUid, body.type, body.key);
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
