"use client";

import BuildingCard from "@/components/BuildingCard";
import type { BuildingRow } from "@/lib/queries";

export default function AddressSearchResults({
  query,
  buildings,
  truncated,
  onViewOnMap,
}: {
  query: string;
  buildings: BuildingRow[];
  truncated: boolean;
  onViewOnMap?: (lat: number, lng: number) => void;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        {buildings.length} result{buildings.length === 1 ? "" : "s"} for &quot;{query}&quot;
        {truncated && " — showing the first 50, refine your search for more"}
      </h2>
      {buildings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-9 text-center text-slate-500">
          No buildings matched that street or address. Only buildings from
          zips searched before are indexed — try searching that zip first.
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
