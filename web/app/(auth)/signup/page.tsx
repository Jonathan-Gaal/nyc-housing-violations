// Client Component: the Firebase Client SDK's account-creation flow requires
// browser-side interactivity, same documented exception class as
// app/(auth)/login/page.tsx (spec 018's Design Pattern). This page is the
// account-creation-only half of the split — see login/page.tsx for the
// sign-in-only half.
'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEMO_ACCOUNT } from '@/lib/demoAccount';
import { initializeApp, getApps, type FirebaseOptions } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

// Duplicated from login/page.tsx rather than extracted to a shared module —
// see spec 018 Constraints: extracting would add a file beyond this spec's
// cap, matching this project's documented SESSION_COOKIE_NAME-duplication
// precedent (web/middleware.ts's comment) for the same tradeoff. Both copies
// must stay in sync.
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
    throw new Error('Sign-up failed. Please try again.');
  }
}

function EyeIcon({ open }: { open: boolean }) {
  // Matches BuildingCard.tsx's inline-SVG icon shape (ChevronIcon/WarningIcon):
  // viewBox 20x20, currentColor fill, no external icon library. Duplicated
  // from login/page.tsx for the same file-cap reason as getFirebaseClientApp above.
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
// wrapped in Suspense (Next.js 16 requirement) — SignupPage below provides
// that boundary so `next build` can still prerender the page shell.
function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const intent = searchParams.get('intent');

  function buildLoginLinkHref(): string {
    const params = new URLSearchParams();
    params.set('callbackUrl', callbackUrl);
    if (intent) params.set('intent', intent);
    return `/login?${params.toString()}`;
  }

  // intent=premium hand-off contract (spec 018's Objective, coordinated with
  // spec 023): after the session cookie is set, redirect to
  // /account/upgrade (spec 022's page) if intent=premium was requested,
  // otherwise go straight to callbackUrl — unchanged behavior from the
  // login page's own redirectAfterSignIn() for the non-premium case.
  function redirectAfterSignUp(): void {
    if (intent === 'premium') {
      const upgradeParams = new URLSearchParams({ callbackUrl });
      router.push(`/account/upgrade?${upgradeParams.toString()}`);
      return;
    }
    router.push(callbackUrl);
  }

  async function handleEmailPasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setShowLoginLink(false);

    // Client-side match check happens before any network call — a
    // mismatched confirmation must never reach Firebase (spec 018
    // Constraints/Security Constraints).
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const auth = getAuth(getFirebaseClientApp());
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await userCredential.user.getIdToken();
      await exchangeIdTokenForSession(idToken);
      redirectAfterSignUp();
    } catch (signUpError) {
      const signUpErrorCode =
        signUpError instanceof Error && 'code' in signUpError
          ? (signUpError as { code: string }).code
          : undefined;
      if (signUpErrorCode === 'auth/email-already-in-use') {
        setErrorMessage('An account with that email already exists.');
        setShowLoginLink(true);
      } else {
        setErrorMessage('Sign-up failed. Please check your details and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn(): Promise<void> {
    setErrorMessage(null);
    setShowLoginLink(false);
    setIsSubmitting(true);
    try {
      const auth = getAuth(getFirebaseClientApp());
      const userCredential = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await userCredential.user.getIdToken();
      await exchangeIdTokenForSession(idToken);
      redirectAfterSignUp();
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
          Just looking around?{' '}
          <Link href={buildLoginLinkHref()} className="font-semibold underline hover:no-underline">
            Use the demo premium account
          </Link>
        </p>
      )}
      <form onSubmit={handleEmailPasswordSubmit} className="flex flex-col gap-4">
        <label htmlFor="signup-email" className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-300">
          Email
          <input
            id="signup-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>

        <PasswordField
          id="signup-password"
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />

        <PasswordField
          id="signup-confirm-password"
          label="Confirm password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
        />

        {errorMessage && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errorMessage}
            {showLoginLink && (
              <>
                {' '}
                <Link href={buildLoginLinkHref()} className="font-semibold underline hover:no-underline">
                  Sign in instead
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
          {isSubmitting ? 'Creating account…' : 'Create account'}
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
        Already have an account?{' '}
        <Link href={buildLoginLinkHref()} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
          Sign in
        </Link>
      </p>
    </>
  );
}

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900 dark:text-slate-100">
        Create an account
      </h1>
      <Suspense
        fallback={<p className="text-center text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
      >
        <SignupForm />
      </Suspense>
    </main>
  );
}
