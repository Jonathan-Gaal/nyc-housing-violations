// examples/middleware.ts
// Middleware for authentication, logging, and cross-cutting concerns
// Pattern: Auth checks, request logging, redirects
// Reference: SKILL.md "Pattern 8: Middleware for Cross-Cutting Concerns"

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Routes that require authentication
const PROTECTED_ROUTES = [
  '/dashboard',
  '/profile',
  '/settings',
  '/admin',
];

// Routes accessible only to admins
const ADMIN_ROUTES = [
  '/admin',
];

// Routes accessible only when logged out (redirect to dashboard if logged in)
const AUTH_ROUTES = [
  '/auth/login',
  '/auth/signup',
  '/auth/forgot-password',
];

// ============================================================================
// MIDDLEWARE
// ============================================================================

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 1. Get session
  const session = await auth();
  const isAuthenticated = !!session?.user;
  const isAdmin = session?.user?.role === 'admin';

  // 2. Log request (development only)
  if (process.env.NODE_ENV === 'development') {
    console.log(`[MIDDLEWARE] ${request.method} ${pathname}`, {
      isAuthenticated,
      userRole: session?.user?.role,
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Redirect authenticated users away from auth routes
  if (isAuthenticated && AUTH_ROUTES.some(route => pathname.startsWith(route))) {
    console.log(`[MIDDLEWARE] Redirecting authenticated user from ${pathname} to /dashboard`);
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // 4. Protect admin routes
  if (ADMIN_ROUTES.some(route => pathname.startsWith(route))) {
    if (!isAuthenticated) {
      console.log(`[MIDDLEWARE] Redirecting unauthenticated user from ${pathname} to /auth/login`);
      return NextResponse.redirect(new URL('/auth/login', request.url));
    }

    if (!isAdmin) {
      console.log(`[MIDDLEWARE] Redirecting non-admin user from ${pathname} to /dashboard`);
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // 5. Protect authenticated routes
  if (PROTECTED_ROUTES.some(route => pathname.startsWith(route))) {
    if (!isAuthenticated) {
      console.log(`[MIDDLEWARE] Redirecting unauthenticated user from ${pathname} to /auth/login`);
      // Preserve the original URL so we can redirect back after login
      const loginUrl = new URL('/auth/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // 6. Add custom headers (optional)
  const response = NextResponse.next();
  response.headers.set('x-user-id', session?.user?.id || 'anonymous');
  response.headers.set('x-user-role', session?.user?.role || 'guest');
  response.headers.set('x-request-id', crypto.randomUUID());

  return response;
}

// ============================================================================
// MATCHER CONFIGURATION
// ============================================================================

// Define which routes should trigger middleware
// This improves performance by skipping middleware for static assets
export const config = {
  matcher: [
    // Protected and auth routes
    '/dashboard/:path*',
    '/profile/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/auth/:path*',
    
    // API routes
    '/api/:path*',

    // Exclude static assets and public files
    '/((?!_next|static|.*\\.svg|.*\\.png|.*\\.jpg|.*\\.gif|.*\\.webp).*)',
  ],
};

// ============================================================================
// BEST PRACTICES DEMONSTRATED
// ============================================================================

// ✅ Authentication: Check session in middleware (server-side)
// ✅ Authorization: Verify user role before granting access
// ✅ Logging: Log important security events
// ✅ Redirects: Preserve callbackUrl for post-login redirect
// ✅ Performance: Use matcher to avoid middleware on static assets
// ✅ Headers: Add custom headers for downstream services
// ✅ Error handling: Clear error messages in logs
// ✅ Security: Never expose sensitive info in logs in production
// ✅ Type safety: Use NextRequest and NextResponse types
// ✅ Separation of concerns: Single responsibility (auth + logging)

// ============================================================================
// EXAMPLE LOGIN COMPONENT WITH CALLBACK
// ============================================================================

/*
'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

export function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // SignIn will redirect to callbackUrl after successful auth
    await signIn('credentials', {
      email: e.currentTarget.email.value,
      password: e.currentTarget.password.value,
      redirect: true,
      redirectTo: callbackUrl,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
    </form>
  );
}
*/
