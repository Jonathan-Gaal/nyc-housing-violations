'use client';

// Exposes current-user auth state by calling GET /api/auth/me — never by
// inspecting document.cookie client-side (the session cookie is HttpOnly
// and intentionally unreadable from JS; see spec 015 Constraints).
import { useCallback, useEffect, useState } from 'react';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  tier: string;
}

export interface UseAuthState {
  user: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface AuthFetchResult {
  user: AuthenticatedUser | null;
  error: string | null;
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { uid?: unknown }).uid === 'string' &&
    typeof (value as { email?: unknown }).email === 'string' &&
    typeof (value as { tier?: unknown }).tier === 'string'
  );
}

// Module-level (not hook-scoped) so the effect below calls a plain async
// function rather than invoking setState synchronously from within the
// effect body itself (react-hooks/set-state-in-effect) — all state updates
// happen after this promise resolves, back in the effect's .then callback.
async function fetchCurrentUserProfile(): Promise<AuthFetchResult> {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });

    if (response.status === 401) {
      // Not logged in — a normal, expected state, not an error.
      return { user: null, error: null };
    }

    if (!response.ok) {
      return { user: null, error: 'Failed to load auth state' };
    }

    const payload: unknown = await response.json();
    return { user: isAuthenticatedUser(payload) ? payload : null, error: null };
  } catch {
    return { user: null, error: 'Failed to load auth state' };
  }
}

export function useAuth(): UseAuthState {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let isCurrentRequest = true;

    fetchCurrentUserProfile().then((result) => {
      if (!isCurrentRequest) return;
      setUser(result.user);
      setError(result.error);
      setLoading(false);
    });

    return () => {
      isCurrentRequest = false;
    };
  }, [refetchToken]);

  // setLoading(true) lives here (an event-handler-triggered callback), not
  // inside the effect body, since react-hooks/set-state-in-effect flags
  // synchronous setState calls at the top of an effect.
  const refetch = useCallback(() => {
    setLoading(true);
    setRefetchToken((previousToken) => previousToken + 1);
  }, []);

  return { user, loading, error, refetch };
}
