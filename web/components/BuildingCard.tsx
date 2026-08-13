"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { BuildingRow, ViolationRow } from "@/lib/queries";
import { ratingTier, ratingLabel, humanizeDaysOpen, type RatingTier } from "@/lib/format";
import { ratingToStars } from "@/lib/starRating";
import StarRating from "@/components/StarRating";
import type { LandlordInfo } from "@/lib/landlords";
import type { LandlordProfile } from "@/lib/landlordProfile";

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
    <span className="inline-flex items-center gap-1.5">
      <StarRating rating={rating} />
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles.badge}`}>
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

function MapPinIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path
        fillRule="evenodd"
        d="M9.69 18.933a.75.75 0 00.62 0c.058-.026 5.68-2.65 5.68-8.183a6.05 6.05 0 00-6-6 6.05 6.05 0 00-6 6c0 5.533 5.622 8.157 5.7 8.183zM10 12a2 2 0 100-4 2 2 0 000 4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ViewOnMapButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
    >
      <MapPinIcon />
      See on map
    </button>
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

export default function BuildingCard({
  building,
  onViewOnMap,
  layout = "stacked",
}: {
  building: BuildingRow;
  onViewOnMap?: (lat: number, lng: number) => void;
  // "inline" puts the See on map button, violation count, and chevron on one
  // row — only fits in the wider "browse all buildings" column. The 360px
  // sidebar ("stacked") doesn't have room for that without truncating
  // addresses and wrapping badges, so it keeps the button on its own row.
  layout?: "stacked" | "inline";
}) {
  const [expanded, setExpanded] = useState(false);
  const [violations, setViolations] = useState<ViolationRow[] | null>(null);
  const [landlord, setLandlord] = useState<LandlordInfo | null>(null);
  const [landlordProfile, setLandlordProfile] = useState<LandlordProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnlyRentImpairing, setShowOnlyRentImpairing] = useState(false);

  async function loadDataIfNeeded() {
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
      setLandlord(data.landlord ?? null);
      setLandlordProfile(data.landlordProfile ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load violations");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    loadDataIfNeeded();
  }

  // Jumps straight to the filtered rent-impairing view, expanding the card
  // first if it's collapsed — same underlying fetch as toggle(), just with
  // the filter pre-applied.
  function showRentImpairingOnly(e: React.MouseEvent) {
    e.stopPropagation();
    setExpanded(true);
    setShowOnlyRentImpairing(true);
    loadDataIfNeeded();
  }

  function viewOnMap(e: React.MouseEvent) {
    e.stopPropagation();
    onViewOnMap?.(building.latitude, building.longitude);
  }

  const allByEntrance = (violations ?? []).reduce<Record<string, ViolationRow[]>>((acc, v) => {
    const key = v.house_number || "Unknown";
    (acc[key] ??= []).push(v);
    return acc;
  }, {});

  // Entrances with zero rent-impairing violations disappear entirely under
  // the filter, rather than showing an empty "Entrance X" header.
  const byEntrance = showOnlyRentImpairing
    ? Object.fromEntries(
        Object.entries(allByEntrance)
          .map(([entrance, list]) => [entrance, list.filter((v) => v.rent_impairing)] as const)
          .filter(([, list]) => list.length > 0)
      )
    : allByEntrance;

  const tier = ratingTier(building.rating);
  const ring = TIER_STYLES[tier].ring;

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ${ring} transition-shadow hover:shadow-md`}
    >
      <div
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        role="button"
        tabIndex={0}
        data-testid="building-card-toggle"
        className="flex w-full cursor-pointer items-start justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">
            {building.house_number_display} {building.street_name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <RatingBadge rating={building.rating} />
            {building.rent_impairing_count > 0 && (
              <button
                onClick={showRentImpairingOnly}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
              >
                <WarningIcon />
                {building.rent_impairing_count} rent-impairing
              </button>
            )}
          </div>
        </div>
        {layout === "inline" ? (
          // Wide "browse all buildings" column: button, count, and chevron
          // fit comfortably on one row.
          <div className="flex shrink-0 items-center gap-2">
            {onViewOnMap && <ViewOnMapButton onClick={viewOnMap} />}
            <div className="text-right">
              <div className="text-lg font-bold text-slate-900">{building.violation_count}</div>
              <div className="text-xs text-slate-500">violation{building.violation_count === 1 ? "" : "s"}</div>
            </div>
            <ChevronIcon open={expanded} />
          </div>
        ) : (
          // Narrow 360px sidebar: same three pieces, but the button on its
          // own row underneath — a single inline row here would truncate
          // addresses and wrap the rent-impairing badge.
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="text-lg font-bold text-slate-900">{building.violation_count}</div>
                <div className="text-xs text-slate-500">violation{building.violation_count === 1 ? "" : "s"}</div>
              </div>
              <ChevronIcon open={expanded} />
            </div>
            {onViewOnMap && <ViewOnMapButton onClick={viewOnMap} />}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              Loading violations…
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && violations !== null && (
            <div className="mb-3 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Registered Owner
              </p>
              {landlord ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-800">
                      {landlord.ownerName ?? "Name not on file"}
                    </p>
                    {landlordProfile && <StarRating rating={landlordProfile.rating} />}
                  </div>
                  {landlord.officerName && landlord.officerName !== landlord.ownerName && (
                    <p className="text-xs text-slate-500">Officer: {landlord.officerName}</p>
                  )}
                  {landlord.agentName && (
                    <p className="text-xs text-slate-500">Agent: {landlord.agentName}</p>
                  )}
                  {landlordProfile && landlord.officerFirstName && landlord.officerLastName && (
                    <Link
                      href={{
                        pathname: "/landlord",
                        query: {
                          firstName: landlord.officerFirstName,
                          lastName: landlord.officerLastName,
                          officerName: landlord.officerName ?? "",
                          ...(landlord.businessAddress ? { businessAddress: landlord.businessAddress } : {}),
                        },
                      }}
                      className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline"
                    >
                      View full landlord profile ({landlordProfile.buildingCount} building
                      {landlordProfile.buildingCount === 1 ? "" : "s"}) →
                    </Link>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No HPD registration on file.</p>
              )}
            </div>
          )}
          {!loading && !error && violations && violations.length > 0 && (
            <ViolationTimeline violations={violations} />
          )}
          {!loading && !error && showOnlyRentImpairing && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
              <span>Showing rent-impairing violations only</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowOnlyRentImpairing(false);
                }}
                className="cursor-pointer underline hover:no-underline"
              >
                Show all
              </button>
            </div>
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
                      <li key={v.violation_id} className="flex items-start justify-between gap-3 py-1.5">
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
