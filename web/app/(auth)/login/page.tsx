// Client Component: the Firebase Client SDK's sign-in flow requires
// browser-side interactivity, so this page is a documented, explicit
// exception to the skill's Server-Components-by-default rule (only the
// interactive sign-in form needs "use client" — matches spec 015's original
// exception, carried forward unchanged by spec 018).
'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { DEMO_ACCOUNT } from '@/lib/demoAccount';
import { useRouter, useSearchParams } from 'next/navigation';
import { initializeApp, getApps, type FirebaseOptions } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

// NEXT_PUBLIC_FIREBASE_API_KEY is client-exposed by Firebase's own design
// (Phase 11's .env.example documents this) — not a secret in the
// traditional sense, unlike FIREBASE_ADMIN_SDK_KEY which never leaves the
// server. Only the API key is required client-side for email/password and
// Google popup sign-in; projectId/authDomain are derived from it by
// Firebase's SDK for this app's minimal auth-only usage.
function getFirebaseClientApp() {
  const firebaseOptions: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  };
  const existingApps = getApps();
  return existingApps.length > 0 ? existingApps[0] : initializeApp(firebaseOptions);
}

// Exchanges a freshly-obtained Firebase ID token for the server's HttpOnly
// session cookie — the ID token is sent exactly once, here, and never
// stored client-side afterward (spec 015's central correction, unchanged).
async function exchangeIdTokenForSession(idToken: string): Promise<void> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    throw new Error('Sign-in failed. Please try again.');
  }
}

function EyeIcon({ open }: { open: boolean }) {
  // Matches BuildingCard.tsx's inline-SVG icon shape (ChevronIcon/WarningIcon):
  // viewBox 20x20, currentColor fill, no external icon library.
  if (open) {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M10 3.5c-4.14 0-7.55 2.6-9 6.5 1.45 3.9 4.86 6.5 9 6.5s7.55-2.6 9-6.5c-1.45-3.9-4.86-6.5-9-6.5zM10 14a4 4 0 110-8 4 4 0 010 8z" />
        <path d="M10 8a2 2 0 100 4 2 2 0 000-4z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.85-1.85c1.6-1.24 2.86-2.9 3.62-4.87-1.45-3.9-4.86-6.5-9-6.5-1.47 0-2.85.33-4.08.93L3.28 2.22zM10 14a4 4 0 01-3.87-5.02l1.15 1.15a2.5 2.5 0 003.24 3.24l1.15 1.15A3.98 3.98 0 0110 14z" />
      <path d="M2 10c.62 1.67 1.68 3.13 3.03 4.24l1.09-1.09A6.5 6.5 0 013.6 10 6.53 6.53 0 019.13 5.15l-1.2-1.2C4.7 4.83 2.72 7.13 2 10z" />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
      {label}
      <span className="relative flex items-center">
        <input
          id={id}
          type={isVisible ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 pr-10 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => setIsVisible((previous) => !previous)}
          aria-label={isVisible ? 'Hide password' : 'Show password'}
          className="absolute right-2 flex h-6 w-6 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <EyeIcon open={isVisible} />
        </button>
      </span>
    </label>
  );
}

// useSearchParams() opts this subtree out of static prerendering unless
// wrapped in Suspense (Next.js 16 requirement) — LoginPage below provides
// that boundary so `next build` can still prerender the page shell.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(DEMO_ACCOUNT?.email ?? '');
  const [password, setPassword] = useState(DEMO_ACCOUNT?.password ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSignupLink, setShowSignupLink] = useState(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const intent = searchParams.get('intent');

  function buildSignupLinkHref(): string {
    const params = new URLSearchParams();
    params.set('callbackUrl', callbackUrl);
    if (intent) params.set('intent', intent);
    return `/signup?${params.toString()}`;
  }

  function redirectAfterSignIn(): void {
    router.push(callbackUrl);
  }

  async function handleEmailPasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setShowSignupLink(false);
    setIsSubmitting(true);
    try {
      const auth = getAuth(getFirebaseClientApp());
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await userCredential.user.getIdToken();
      await exchangeIdTokenForSession(idToken);
      redirectAfterSignIn();
    } catch (signInError) {
      const signInErrorCode =
        signInError instanceof Error && 'code' in signInError
          ? (signInError as { code: string }).code
          : undefined;
      if (signInErrorCode === 'auth/user-not-found' || signInErrorCode === 'auth/invalid-credential') {
        // No fallback account creation here — sign-in failure surfaces as an
        // explicit error with a link to /signup, per spec 018's Objective
        // (this is the exact behavior being removed from the old combined
        // page's silent createUserWithEmailAndPassword fallback).
        setErrorMessage("We couldn't find an account with that email and password.");
        setShowSignupLink(true);
      } else {
        setErrorMessage('Sign-in failed. Check your email and password and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn(): Promise<void> {
    setErrorMessage(null);
    setShowSignupLink(false);
    setIsSubmitting(true);
    try {
      const auth = getAuth(getFirebaseClientApp());
      const userCredential = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await userCredential.user.getIdToken();
      await exchangeIdTokenForSession(idToken);
      redirectAfterSignIn();
    } catch {
      setErrorMessage('Google sign-in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {DEMO_ACCOUNT && (
        <p className="mb-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          Demo premium account pre-filled — just click Sign in.
        </p>
      )}
      <form onSubmit={handleEmailPasswordSubmit} className="flex flex-col gap-4">
        <label htmlFor="login-email" className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
          Email
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <PasswordField
          id="login-password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />

        {errorMessage && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errorMessage}
            {showSignupLink && (
              <>
                {' '}
                <Link href={buildSignupLinkHref()} className="font-semibold underline hover:no-underline">
                  Create an account
                </Link>
              </>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="my-4 text-center text-sm text-slate-500 dark:text-slate-400">or</div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isSubmitting}
        className="rounded border border-slate-300 px-4 py-2 font-medium text-slate-900 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100"
      >
        Continue with Google
      </button>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Don&apos;t have an account?{' '}
        <Link href={buildSignupLinkHref()} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
          Sign up
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900 dark:text-slate-100">Sign in</h1>
      <Suspense
        fallback={<p className="text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
