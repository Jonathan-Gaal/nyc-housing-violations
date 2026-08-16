// Favorites page (spec 021) — lists a signed-in user's saved buildings and
// landlord profiles, built against spec 019's GET/POST/DELETE /api/favorites
// route. Client Component: needs useAuth() + fetch on mount, same
// interactivity exception class as app/landlord/page.tsx's own data-fetch
// pattern. Already covered by middleware.ts's PROTECTED_PATHS (spec 019
// added /favorites there in anticipation of this page).
//
// No tier check here — premium-gating/paywall treatment of this page is
// spec 020's job, which edits this file in place afterward.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BuildingCard from "@/components/BuildingCard";
import StarRating from "@/components/StarRating";
import type { BuildingRow } from "@/lib/queries";
import { ratingToStars } from "@/lib/starRating";
import { ratingTier, ratingLabel, type RatingTier } from "@/lib/format";

interface FavoriteLandlord {
  landlordKey: string;
  officerName: string;
  businessAddress: string | null;
  buildingCount: number;
  rating: number;
}

interface FavoritesResponse {
  buildings: BuildingRow[];
  landlords: FavoriteLandlord[];
}

const TIER_STYLES: Record<RatingTier, string> = {
  good: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300",
  fair: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
};

function isFavoritesResponse(value: unknown): value is FavoritesResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { buildings?: unknown }).buildings) &&
    Array.isArray((value as { landlords?: unknown }).landlords)
  );
}

function LandlordFavoriteCard({ landlord }: { landlord: FavoriteLandlord }) {
  const officerNameParts = landlord.officerName.split(" ");
  const firstName = officerNameParts[0] ?? "";
  const lastName = officerNameParts.slice(1).join(" ");

  return (
    <Link
      href={{
        pathname: "/landlord",
        query: {
          firstName,
          lastName,
          officerName: landlord.officerName,
          ...(landlord.businessAddress ? { businessAddress: landlord.businessAddress } : {}),
        },
      }}
      className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
    >
      <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
        {landlord.officerName}
      </h3>
      {landlord.businessAddress && (
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{landlord.businessAddress}</p>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <StarRating rating={landlord.rating} />
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_STYLES[ratingTier(landlord.rating)]}`}
        >
          {ratingToStars(landlord.rating).toFixed(1)} · {ratingLabel(landlord.rating)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {landlord.buildingCount} building{landlord.buildingCount === 1 ? "" : "s"}
      </p>
    </Link>
  );
}

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoritesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrentRequest = true;

    fetch("/api/favorites", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) {
          return { user: null, error: "Sign in to view your saved buildings and landlords." };
        }
        if (!response.ok) {
          return { user: null, error: "Failed to load favorites." };
        }
        const payload: unknown = await response.json();
        if (!isFavoritesResponse(payload)) {
          return { user: null, error: "Failed to load favorites." };
        }
        return { user: payload, error: null };
      })
      .then((result) => {
        if (!isCurrentRequest) return;
        setFavorites(result.user);
        setError(result.error);
        setLoading(false);
      })
      .catch(() => {
        if (!isCurrentRequest) return;
        setError("Failed to load favorites.");
        setLoading(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, []);

  const hasNoFavorites =
    favorites !== null && favorites.buildings.length === 0 && favorites.landlords.length === 0;

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
            ← Back to search
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-100">My favorites</h1>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300" />
            Loading favorites…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && hasNoFavorites && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No saved buildings or landlords yet.
          </p>
        )}

        {!loading && !error && favorites && favorites.buildings.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
              Saved buildings ({favorites.buildings.length})
            </h2>
            <div className="flex flex-col gap-3">
              {favorites.buildings.map((building) => (
                <BuildingCard key={building.building_id} building={building} layout="inline" />
              ))}
            </div>
          </section>
        )}

        {!loading && !error && favorites && favorites.landlords.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
              Saved landlords ({favorites.landlords.length})
            </h2>
            <div className="flex flex-col gap-3">
              {favorites.landlords.map((landlord) => (
                <LandlordFavoriteCard key={landlord.landlordKey} landlord={landlord} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
