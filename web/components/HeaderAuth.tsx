"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

// Header account controls: Sign in / Sign up when signed out; Favorites,
// tier status (Premium badge or Go Premium link) and Log out when signed
// in. Renders nothing while the session check is in flight so the header
// doesn't flash the signed-out buttons for a signed-in user.
export default function HeaderAuth() {
  const { user, loading, refetch } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    } finally {
      setIsSigningOut(false);
      refetch();
    }
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/login"
          className="rounded px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Link
        href="/favorites"
        className="rounded px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Favorites
      </Link>
      {user.tier === "premium" ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          Premium
        </span>
      ) : (
        <Link
          href="/account/upgrade"
          className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
        >
          Go Premium
        </Link>
      )}
      <button
        type="button"
        onClick={signOut}
        disabled={isSigningOut}
        title={`Signed in as ${user.email}`}
        aria-label="Log out"
        className="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        Log out
      </button>
    </div>
  );
}
