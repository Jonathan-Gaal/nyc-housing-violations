// Favorites API (spec 019) — GET/POST/DELETE a signed-in user's saved
// buildings/landlord profiles. Single route, `type`-param dispatch (not
// /api/favorites/buildings + /api/favorites/landlords) to stay under that
// spec's file cap while covering both resource types.
//
// Favorites are premium-gated (spec 020): every handler calls
// requirePremiumTier() — a strict superset of verifySessionCookie()'s
// pattern (cookie -> cryptographic verify -> derive UID -> DB tier lookup)
// — never relying on middleware.ts's presence-only check as the actual
// boundary. Unauthenticated -> 401; authenticated-but-free -> 403
// { error: 'premium_required' }; premium -> existing behavior unchanged.
//
// The verified UID is the only source of "whose favorites" — firebase_uid
// is never accepted as a client-supplied body/query param, so one user can
// never read/write another user's favorites by passing an arbitrary UID.
import { requirePremiumTier } from '@/lib/requirePremiumTier';
import { getPool } from '@/lib/pgClient';
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

// Shared tier-gate response builder — 401 for a logged-out/unverifiable
// session, 403 { error: 'premium_required' } for a verified-but-free-tier
// user. Returns null when the caller is authorized to proceed.
async function requireAuthorizedFirebaseUid(): Promise<{ uid: string } | Response> {
  const tierResult = await requirePremiumTier();
  if (!tierResult.authorized) {
    const status = tierResult.reason === 'unauthenticated' ? 401 : 403;
    const body =
      tierResult.reason === 'unauthenticated'
        ? { authenticated: false }
        : { error: 'premium_required' };
    return Response.json(body, { status });
  }
  return { uid: tierResult.uid };
}

function isDeniedResponse(value: { uid: string } | Response): value is Response {
  return value instanceof Response;
}

export async function GET() {
  const authResult = await requireAuthorizedFirebaseUid();
  if (isDeniedResponse(authResult)) return authResult;

  try {
    const pool = getPool();
    const favorites = await listFavoritesForUser(pool, authResult.uid);
    return Response.json(favorites, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await requireAuthorizedFirebaseUid();
  if (isDeniedResponse(authResult)) return authResult;

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
    await addFavorite(pool, authResult.uid, body.type, body.key);
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const authResult = await requireAuthorizedFirebaseUid();
  if (isDeniedResponse(authResult)) return authResult;

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
    await removeFavorite(pool, authResult.uid, body.type, body.key);
    return Response.json({ ok: true }, { status: 200 });
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
