// Protects the configured routes by checking for the HttpOnly session
// cookie (never a client-sent Authorization header — see spec 015's
// Objective for why: the whole point of this correction is that the token
// is never client-readable to attach as a header in the first place).
// Mirrors the nextjs-frontend skill's Pattern 8 example shape, adapted to a
// cookie check rather than a header check.
//
// SECURITY BOUNDARY NOTE (Mode-2 correction, ratchet): this check is
// presence-only — it does NOT cryptographically verify the cookie's value.
// That is an acceptable, deliberate split, not an oversight: middleware
// runs in the Edge runtime, which cannot import firebase-admin (see the
// SESSION_COOKIE_NAME duplication note below), so it cannot call
// verifySessionCookie() itself. This makes middleware a cheap first gate
// (redirect obviously-logged-out users early) — NOT the actual security
// boundary. The real boundary is any route that serves data: it MUST call
// verifySessionCookie() (app/api/auth/me/route.ts does) before trusting the
// cookie's value for anything. A forged cookie that passes this
// presence-only check will still be rejected by /api/auth/me. This spec
// adds no other protected route/page — PROTECTED_PATHS below are
// placeholder paths reserved for future phases (Phase 13+), not real
// data-serving pages yet, so there is nothing else in this spec's scope
// that skips the cryptographic check.
import { NextResponse, type NextRequest } from 'next/server';

// Deliberately NOT imported from app/api/auth/session/route.ts: that module
// pulls in firebaseAdmin.ts (firebase-admin) and pgClient.ts (pg), both
// Node-only dependency graphs that fail to bundle for middleware ("Failed
// to load external module node:util/types" under next dev) — discovered
// while building this spec, see log.md. Duplicating this one string
// constant keeps middleware's bundle isolated from those heavy server-only
// SDKs; both copies must stay in sync (also defined in
// app/api/auth/session/route.ts and read in app/api/auth/me/route.ts).
const SESSION_COOKIE_NAME = 'session';

// Routes that require a valid session cookie. Extend this list as
// premium-tier/account routes are added in later phases.
const PROTECTED_PATHS = ['/dashboard', '/account'];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((protectedPath) => pathname.startsWith(protectedPath));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie || sessionCookie.value.trim().length === 0) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/account/:path*'],
};
