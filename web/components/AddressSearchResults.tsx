"use client";

import BuildingCard from "@/components/BuildingCard";
import type { BuildingRow } from "@/lib/queries";

// Pulled out of the query text (e.g. "233 west 14th st 10011") so a
// no-match result can offer "search zip 10011 directly" — that flow can
// live-fetch an unseeded zip, unlike address search (see
// lib/queries.ts's searchBuildingsByAddress).
function extractZipFromQuery(query: string): string | null {
  return query.match(/\b\d{5}\b/)?.[0] ?? null;
}

export default function AddressSearchResults({
  query,
  buildings,
  truncated,
  onViewOnMap,
  onSearchZip,
}: {
  query: string;
  buildings: BuildingRow[];
  truncated: boolean;
  onViewOnMap?: (lat: number, lng: number) => void;
  onSearchZip?: (zip: string) => void;
}) {
  const suggestedZip = buildings.length === 0 ? extractZipFromQuery(query) : null;

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
        {buildings.length} result{buildings.length === 1 ? "" : "s"} for &quot;{query}&quot;
        {truncated && " — showing the first 50, refine your search for more"}
      </h2>
      {buildings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-9 text-center text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
          <p>
            No buildings with currently open violations matched that search.
            This only searches buildings already indexed from a zip search —
            and only ones with at least one open violation, so a building
            with a clean record won&apos;t show up here either way.
          </p>
          {suggestedZip && onSearchZip && (
            <button
              onClick={() => onSearchZip(suggestedZip)}
              className="mt-3 cursor-pointer rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Search zip {suggestedZip} directly
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 lg:max-h-[600px] lg:overflow-y-auto lg:pr-1">
          {buildings.map((b) => (
            <BuildingCard key={b.building_id} building={b} onViewOnMap={onViewOnMap} />
          ))}
        </div>
      )}
    </div>
  );
}
