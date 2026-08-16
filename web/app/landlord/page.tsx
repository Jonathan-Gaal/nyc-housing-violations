"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import StarRating from "@/components/StarRating";
import { ratingToStars } from "@/lib/starRating";
import { ratingTier, ratingLabel, type RatingTier } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";

interface LandlordProfile {
  landlordKey: string;
  officerName: string;
  businessAddress: string | null;
  buildingCount: number;
  totalViolationCount: number;
  totalRentImpairingCount: number;
  avgYearsOpen: number;
  rating: number;
  buildingIds: string[];
  buildingAddresses: string[];
}

const TIER_STYLES: Record<RatingTier, string> = {
  good: "bg-green-100 text-green-800",
  fair: "bg-yellow-100 text-yellow-800",
  bad: "bg-red-100 text-red-800",
};

function BookmarkIcon({ filled }: { filled: boolean }) {
  // Same icon shape as BuildingCard.tsx's BookmarkIcon — duplicated rather
  // than shared to stay within this spec's 4-file cap (matches this
  // project's documented SESSION_COOKIE_NAME-duplication precedent for the
  // same file-cap tradeoff).
  return filled ? (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M5.5 3A1.5 1.5 0 004 4.5v12.19a.75.75 0 001.17.62L10 14.06l4.83 3.25a.75.75 0 001.17-.62V4.5A1.5 1.5 0 0014.5 3h-9z" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <path d="M5.5 3.75A1.75 1.75 0 017.25 2h5.5a1.75 1.75 0 011.75 1.75v13.5l-5.5-3.7-5.5 3.7V3.75z" />
    </svg>
  );
}

// Save/unsave a landlord profile against spec 019's /api/favorites API,
// same optimistic-toggle/revert-on-failure shape as BuildingCard.tsx's
// SaveBuildingButton, keyed on type: 'landlord' instead of 'building'.
function SaveLandlordButton({ landlordKey }: { landlordKey: string }) {
  const { user } = useAuth();
  const [isSaved, setIsSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);

  async function toggleSaved() {
    if (!user) {
      setShowSignInPrompt(true);
      return;
    }

    const nextSaved = !isSaved;
    setIsSaved(nextSaved);
    setShowSignInPrompt(false);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/favorites", {
        method: nextSaved ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "landlord", key: landlordKey }),
      });
      if (response.status === 401) {
        setIsSaved(!nextSaved);
        setShowSignInPrompt(true);
        return;
      }
      if (!response.ok) {
        setIsSaved(!nextSaved);
      }
    } catch {
      setIsSaved(!nextSaved);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={toggleSaved}
        disabled={isSubmitting}
        aria-label={isSaved ? "Remove from favorites" : "Save landlord profile"}
        aria-pressed={isSaved}
        className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
          isSaved
            ? "border-amber-300 text-amber-500 hover:text-amber-600"
            : "border-slate-200 text-slate-400 hover:text-slate-600"
        }`}
      >
        <BookmarkIcon filled={isSaved} />
      </button>
      {showSignInPrompt && (
        <span className="absolute top-8 left-0 z-10 w-max max-w-[10rem] rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg">
          Sign in to save
        </span>
      )}
    </span>
  );
}

function LandlordProfileContent() {
  const searchParams = useSearchParams();
  const firstName = searchParams.get("firstName");
  const lastName = searchParams.get("lastName");
  const officerName = searchParams.get("officerName");
  const businessAddress = searchParams.get("businessAddress");

  const missingParams = !firstName || !lastName || !officerName;

  const [profile, setProfile] = useState<LandlordProfile | null>(null);
  const [loading, setLoading] = useState(!missingParams);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firstName || !lastName || !officerName) return;

    const params = new URLSearchParams({ firstName, lastName, officerName });
    if (businessAddress) params.set("businessAddress", businessAddress);

    fetch(`/api/landlord?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setProfile(data.profile);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load landlord profile"))
      .finally(() => setLoading(false));
  }, [firstName, lastName, officerName, businessAddress]);

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-blue-600 hover:underline">
            ← Back to search
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            Loading landlord profile…
          </div>
        )}

        {(missingParams || error) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {missingParams ? "Missing landlord information" : error}
          </div>
        )}

        {!loading && !error && profile && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">{profile.officerName}</h1>
            {profile.businessAddress && (
              <p className="mt-1 text-sm text-slate-500">{profile.businessAddress}</p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <StarRating rating={profile.rating} size="md" />
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TIER_STYLES[ratingTier(profile.rating)]}`}
              >
                {ratingToStars(profile.rating).toFixed(1)} · {ratingLabel(profile.rating)}
              </span>
              <SaveLandlordButton landlordKey={profile.landlordKey} />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-bold text-slate-900">{profile.buildingCount}</div>
                <div className="mt-0.5 text-xs font-medium text-slate-500">Buildings</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-bold text-slate-900">
                  {profile.totalViolationCount.toLocaleString()}
                </div>
                <div className="mt-0.5 text-xs font-medium text-slate-500">Open violations</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-2xl font-bold text-red-600">
                  {profile.totalRentImpairingCount.toLocaleString()}
                </div>
                <div className="mt-0.5 text-xs font-medium text-slate-500">Rent-impairing</div>
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-600">
              Violations persist an average of{" "}
              <span className="font-semibold">{profile.avgYearsOpen.toFixed(1)} years</span> across
              this portfolio.
            </p>

            <h2 className="mt-8 mb-3 text-sm font-semibold text-slate-700">
              Buildings under this owner ({profile.buildingCount})
            </h2>
            {profile.buildingCount === 0 ? (
              <p className="text-sm text-slate-500">
                No other buildings found under this officer&apos;s name and business address.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {profile.buildingAddresses.map((address, i) => (
                  <li
                    key={profile.buildingIds[i]}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700"
                  >
                    {address}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-6 text-xs text-slate-400">
              Buildings matched by officer name + business address, not a stable ID — this is a
              best-effort portfolio, not a legal record of ownership.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

export default function LandlordProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">Loading…</div>
      }
    >
      <LandlordProfileContent />
    </Suspense>
  );
}
