"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { BuildingRow, ViolationRow } from "@/lib/queries";
import { ratingTier, ratingLabel, humanizeDaysOpen, type RatingTier } from "@/lib/format";
import { ratingToStars } from "@/lib/starRating";
import StarRating from "@/components/StarRating";

// Chart.js is a heavy library — dynamically imported (ssr: false) so it's
// only pulled into the client bundle once a building card is expanded, same
// "heavy library, defer loading" treatment app/page.tsx already gives
// MapView.tsx/Mapbox GL (specs/010-chartjs-violation-timeline.md).
const ViolationTimeline = dynamic(() => import("@/components/ViolationTimeline"), {
  ssr: false,
});

// Explicit red/yellow/green severity coding — bad/fair/good.
const TIER_STYLES: Record<RatingTier, { badge: string; ring: string }> = {
  good: { badge: "bg-green-100 text-green-800", ring: "ring-green-200" },
  fair: { badge: "bg-yellow-100 text-yellow-800", ring: "ring-yellow-200" },
  bad: { badge: "bg-red-100 text-red-800", ring: "ring-red-200" },
};

function RatingBadge({ rating }: { rating: number }) {
  const tier = ratingTier(rating);
  const styles = TIER_STYLES[tier];
  const stars = ratingToStars(rating);
  return (
    <span className="inline-flex items-center gap-2">
      <StarRating rating={rating} />
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles.badge}`}>
        {stars.toFixed(1)} · {ratingLabel(rating)}
      </span>
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-5 w-5 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.293l3.71-4.06a.75.75 0 111.08 1.04l-4.24 4.65a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function BuildingCard({ building }: { building: BuildingRow }) {
  const [expanded, setExpanded] = useState(false);
  const [violations, setViolations] = useState<ViolationRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (violations !== null) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/violations?buildingId=${encodeURIComponent(building.building_id)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load violations");
      setViolations(data.violations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load violations");
    } finally {
      setLoading(false);
    }
  }

  const byEntrance = (violations ?? []).reduce<Record<string, ViolationRow[]>>((acc, v) => {
    const key = v.house_number || "Unknown";
    (acc[key] ??= []).push(v);
    return acc;
  }, {});

  const tier = ratingTier(building.rating);
  const ring = TIER_STYLES[tier].ring;

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ${ring} transition-shadow hover:shadow-md`}
    >
      <button
        onClick={toggle}
        className="flex w-full cursor-pointer items-start justify-between gap-4 p-4 text-left"
      >
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900">
            {building.house_number_display} {building.street_name}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <RatingBadge rating={building.rating} />
            {building.rent_impairing_count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                <WarningIcon />
                {building.rent_impairing_count} rent-impairing
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="text-xl font-bold text-slate-900">{building.violation_count}</div>
            <div className="text-xs text-slate-500">violation{building.violation_count === 1 ? "" : "s"}</div>
          </div>
          <ChevronIcon open={expanded} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              Loading violations…
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && violations && violations.length > 0 && (
            <ViolationTimeline violations={violations} />
          )}
          {/* Capped + scrollable: a building with hundreds of violations
              (common — see lib/queries.ts's getPaginatedBuildingsForZip)
              would otherwise render an unbounded list and blow the card out
              to thousands of pixels tall. */}
          {!loading && !error && violations && violations.length > 0 && (
            <div className="max-h-80 overflow-y-auto pr-1">
              {Object.entries(byEntrance).map(([entrance, list]) => (
                <div key={entrance} className="mb-3 last:mb-0">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Entrance {entrance}
                  </h4>
                  <ul className="divide-y divide-slate-100">
                    {list.map((v) => (
                      <li key={v.violation_id} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-700">
                            {v.nov_description || v.nov_type || "Violation"}
                          </p>
                          {v.rent_impairing ? (
                            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                              <WarningIcon /> Rent-impairing
                            </span>
                          ) : null}
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">
                          {humanizeDaysOpen(v.days_open)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
