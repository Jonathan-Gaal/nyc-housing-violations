"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import BuildingCard from "@/components/BuildingCard";
import AllBuildingsBrowser from "@/components/AllBuildingsBrowser";
import type { BuildingRow, ZipSummary, HeatmapPoint } from "@/lib/queries";
import type { MapFocusPoint } from "@/components/MapView";
import { neighborhoodForZip } from "@/lib/zipNeighborhoods";
import { isKnownNycZip } from "@/lib/nycZips";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const LoadingGame = dynamic(() => import("@/components/LoadingGame"), { ssr: false });

function HouseMarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-blue-600">
      <path
        d="M3 10.5 12 3l9 7.5M5.5 9v10a1 1 0 001 1H10v-5.5a1 1 0 011-1h2a1 1 0 011 1V20h3.5a1 1 0 001-1V9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-slate-400">
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
      <div className={`text-2xl font-bold ${tone === "danger" ? "text-red-600" : "text-slate-900"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

export default function Home() {
  const [zipInput, setZipInput] = useState("");
  const [searchedZip, setSearchedZip] = useState<string | null>(null);
  const [summary, setSummary] = useState<ZipSummary | null>(null);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [focusPoint, setFocusPoint] = useState<MapFocusPoint | null>(null);

  // Always a new object, even for a repeat click on the same building — this
  // is what lets MapView's focusPoint effect re-fire on identical
  // coordinates (see components/MapView.tsx).
  function viewOnMap(lat: number, lng: number) {
    setFocusPoint({ lat, lng });
  }

  const hasNonDigitInput = zipInput.length > 0 && !/^\d*$/.test(zipInput);
  const isCompleteZipFormat = /^\d{5}$/.test(zipInput);
  const isRecognizedZip = isCompleteZipFormat && isKnownNycZip(zipInput);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const res = await fetch(`/api/buildings?zip=${encodeURIComponent(zipInput)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setSummary(data.summary);
      setBuildings(data.topBuildings);
      setSearchedZip(zipInput);

      const heatmapRes = await fetch(`/api/heatmap?zip=${encodeURIComponent(zipInput)}`);
      const heatmapData = await heatmapRes.json();
      setPoints(heatmapRes.ok ? heatmapData.points : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setSummary(null);
      setBuildings([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full">
      {loading && <LoadingGame />}

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <HouseMarkIcon />
          <span className="text-lg font-bold tracking-tight text-slate-900">Open Violation NYC</span>
          <span className="ml-auto hidden text-xs text-slate-400 sm:block">
            Data: NYC Dept. of Housing Preservation &amp; Development
          </span>
        </div>
      </header>

      {/* Hero + search */}
      <section className="border-b border-slate-200 bg-gradient-to-b from-blue-50 to-white">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Know before you sign the lease
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-slate-600">
            Search open housing violations by zip code so you can steer clear of
            the worst-maintained buildings and find a genuinely safe place to live.
          </p>

          <form onSubmit={handleSearch} className="mx-auto mt-6 flex max-w-md gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                <SearchIcon />
              </span>
              <label htmlFor="zip-search-input" className="sr-only">
                Zip code
              </label>
              <input
                id="zip-search-input"
                type="text"
                inputMode="numeric"
                aria-label="Zip code"
                value={zipInput}
                onChange={(e) => setZipInput(e.target.value)}
                placeholder="Enter a zip code, e.g. 11106"
                className={`w-full rounded-full border bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none focus:ring-2 ${
                  hasNonDigitInput
                    ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                    : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"
                }`}
                maxLength={5}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="cursor-pointer rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </form>
          {hasNonDigitInput && (
            <p className="mt-2 text-xs font-medium text-red-600">Zip code must be numbers only</p>
          )}
          {isCompleteZipFormat && !isRecognizedZip && (
            <p className="mt-2 text-xs font-medium text-amber-600">
              Doesn&apos;t look like a recognized NYC zip code — you can still search.
            </p>
          )}
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {error && (
          <div className="mx-auto mb-6 max-w-3xl flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!hasSearched && !error && (
          <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-slate-500">
            Try a New York City zip code above to see how buildings in that area
            are rated.
          </div>
        )}

        {summary && searchedZip && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Open violations" value={summary.totalViolations.toLocaleString()} />
              <StatCard label="Buildings" value={summary.totalBuildings.toLocaleString()} />
              <StatCard
                label="Avg. rating"
                value={summary.avgRating != null ? summary.avgRating.toFixed(1) : "—"}
              />
              <StatCard
                label="Worst rating"
                value={summary.worstBuilding ? summary.worstBuilding.rating.toFixed(1) : "—"}
                tone="danger"
              />
            </div>

            {buildings.length === 0 ? (
              isKnownNycZip(searchedZip) ? (
                <div className="mx-auto max-w-3xl rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center text-emerald-800">
                  No open violations found for zip {searchedZip}. Nice.
                </div>
              ) : (
                <div className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-6 py-8 text-center text-amber-800">
                  <p className="font-semibold">No such zip code</p>
                  <p className="mt-1 text-sm">
                    &quot;{searchedZip}&quot; doesn&apos;t appear to be a recognized NYC zip code —
                    double-check it and try again.
                  </p>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
                <aside className="order-2 lg:order-1">
                  <h2 className="mb-3 text-sm font-semibold text-slate-700">
                    Top 10 worst buildings in{" "}
                    {neighborhoodForZip(searchedZip)
                      ? `${neighborhoodForZip(searchedZip)}, ${searchedZip}`
                      : `zip ${searchedZip}`}
                  </h2>
                  <div className="flex flex-col gap-3 lg:max-h-[600px] lg:overflow-y-auto lg:pr-1">
                    {buildings.map((b) => (
                      <BuildingCard key={b.building_id} building={b} onViewOnMap={viewOnMap} />
                    ))}
                  </div>
                </aside>
                <div className="order-1 lg:order-2">
                  <MapView points={points} focusPoint={focusPoint} />
                  <AllBuildingsBrowser zip={searchedZip} onViewOnMap={viewOnMap} />
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        Violation data from NYC Open Data (HPD). Ratings are calculated
        deterministically from violation count, age, and severity — not by AI.
      </footer>
    </div>
  );
}
