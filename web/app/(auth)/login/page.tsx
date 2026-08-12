// Client Component: the Firebase Client SDK's sign-in flow requires
// browser-side interactivity, so this page is a documented, explicit
// exception to the skill's Server-Components-by-default rule (only the
// interactive sign-in form needs "use client" — spec 015 stays at its
// 5-file cap by keeping the static shell and the form in one file rather
// than splitting into a separate LoginForm.tsx).
'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { initializeApp, getApps, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';

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
// stored client-side afterward (spec 015's central correction).
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

// useSearchParams() opts this subtree out of static prerendering unless
// wrapped in Suspense (Next.js 16 requirement) — LoginPage below provides
// that boundary so `next build` can still prerender the page shell.
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function redirectAfterSignIn(): void {
    const callbackUrl = searchParams.get('callbackUrl') || '/';
    router.push(callbackUrl);
  }

  async function handleEmailPasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const auth = getAuth(getFirebaseClientApp());
      // Firebase Auth creates the account on first sign-in for
      // email/password when no existing account matches — this single form
      // reasonably serves both login and signup (spec 015 Files note),
      // falling back to account creation only if sign-in reports no such
      // user exists.
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      } catch (signInError) {
        const signInErrorCode =
          signInError instanceof Error && 'code' in signInError
            ? (signInError as { code: string }).code
            : undefined;
        if (signInErrorCode === 'auth/user-not-found' || signInErrorCode === 'auth/invalid-credential') {
          userCredential = await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw signInError;
        }
      }

      const idToken = await userCredential.user.getIdToken();
      await exchangeIdTokenForSession(idToken);
      redirectAfterSignIn();
    } catch {
      setErrorMessage('Sign-in failed. Check your email and password and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn(): Promise<void> {
    setErrorMessage(null);
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
      <form onSubmit={handleEmailPasswordSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>

        {errorMessage && (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage}
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

      <div className="my-4 text-center text-sm text-gray-500">or</div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isSubmitting}
        className="rounded border border-gray-300 px-4 py-2 font-medium disabled:opacity-50"
      >
        Continue with Google
      </button>
    </>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-semibold">Sign in</h1>
      <Suspense fallback={<p className="text-center text-sm text-gray-500">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
