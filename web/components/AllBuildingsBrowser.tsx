"use client";

import { useState } from "react";
import BuildingCard from "@/components/BuildingCard";
import type { BuildingSortOrder, PaginatedBuildings } from "@/lib/queries";
import { neighborhoodForZip } from "@/lib/zipNeighborhoods";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-5 w-5 shrink-0 text-white transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.293l3.71-4.06a.75.75 0 111.08 1.04l-4.24 4.65a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 text-white">
      <path d="M3 4.5A1.5 1.5 0 014.5 3h11A1.5 1.5 0 0117 4.5v.75a.75.75 0 01-1.5 0V4.5h-11v11h11v-.75a.75.75 0 011.5 0v.75a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15.5v-11z" />
      <path d="M7 7.75A.75.75 0 017.75 7h8.5a.75.75 0 010 1.5h-8.5A.75.75 0 017 7.75zm0 2.25a.75.75 0 01.75-.75h8.5a.75.75 0 010 1.5h-8.5a.75.75 0 01-.75-.75zm0 2.25a.75.75 0 01.75-.75h8.5a.75.75 0 010 1.5h-8.5a.75.75 0 01-.75-.75z" />
    </svg>
  );
}

export default function AllBuildingsBrowser({
  zip,
  onViewOnMap,
}: {
  zip: string;
  onViewOnMap?: (lat: number, lng: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<PaginatedBuildings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<BuildingSortOrder>("worst");
  // Only set while the user is actively typing a page number; cleared back
  // to null on every successful load (loadPage below) so the input falls
  // back to showing `data.page` — the currently-displayed page — instead of
  // a stale typed value or a blank field.
  const [pageInputOverride, setPageInputOverride] = useState<string | null>(null);

  async function loadPage(page: number, sortOverride?: BuildingSortOrder) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/buildings/all?zip=${encodeURIComponent(zip)}&page=${page}&sort=${sortOverride ?? sort}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load buildings");
      setData(json);
      setPageInputOverride(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load buildings");
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (data === null) {
      await loadPage(1);
    }
  }

  function handleSortChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newSort = e.target.value as BuildingSortOrder;
    setSort(newSort);
    loadPage(1, newSort);
  }

  function handlePageJump(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const requested = Number(pageInputOverride ?? data.page);
    if (!Number.isFinite(requested)) return;
    const clamped = Math.min(Math.max(1, Math.floor(requested)), data.totalPages);
    loadPage(clamped);
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
      <button
        onClick={toggle}
        className="flex w-full cursor-pointer items-center justify-between gap-4 bg-blue-600 px-3.5 py-2.5 text-left transition-colors hover:bg-blue-700"
      >
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <ListIcon />
          Browse all buildings in{" "}
          {neighborhoodForZip(zip) ? `${neighborhoodForZip(zip)}, ${zip}` : `zip ${zip}`}
          {data ? ` - ${data.totalBuildings.toLocaleString()} buildings` : ""}
        </span>
        <ChevronIcon open={expanded} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-2">
          {loading && !data && (
            <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
              Loading buildings…
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {data && (
            // Capped to a normal reading width even inside the wide map
            // column — otherwise violation description text (often long
            // legal boilerplate) stretches into single lines 1000+px wide
            // instead of wrapping/truncating like it does in the sidebar.
            <div className="mx-auto max-w-2xl">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>{data.totalBuildings.toLocaleString()} buildings</span>
                <label className="flex items-center gap-1.5">
                  Sort:
                  <select
                    value={sort}
                    onChange={handleSortChange}
                    disabled={loading}
                    className="cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="worst">Worst rated first</option>
                    <option value="best">Best rated first</option>
                  </select>
                </label>
              </div>

              {/* Shows ~6 collapsed cards before scrolling — at
                  PAGE_SIZE=20 (web/app/api/buildings/all/route.ts)
                  buildings, an unbounded list here pushed the whole page to
                  several thousand pixels tall. Stays scrollable/paginated
                  rather than growing to fit all 20. */}
              <div className="flex max-h-[470px] flex-col gap-2.5 overflow-y-auto pr-1">
                {data.buildings.map((b) => (
                  <BuildingCard
                    key={b.building_id}
                    building={b}
                    onViewOnMap={onViewOnMap}
                    layout="inline"
                  />
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => loadPage(1)}
                    disabled={data.page <= 1 || loading}
                    className="cursor-pointer rounded-full border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    « First
                  </button>
                  <button
                    onClick={() => loadPage(data.page - 1)}
                    disabled={data.page <= 1 || loading}
                    className="cursor-pointer rounded-full border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                </div>
                <span className="text-slate-500">
                  Page {data.page} of {data.totalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => loadPage(data.page + 1)}
                    disabled={data.page >= data.totalPages || loading}
                    className="cursor-pointer rounded-full border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => loadPage(data.totalPages)}
                    disabled={data.page >= data.totalPages || loading}
                    className="cursor-pointer rounded-full border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Last »
                  </button>
                </div>
              </div>

              <form
                onSubmit={handlePageJump}
                className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-500"
              >
                <label htmlFor="browse-all-page-jump">Go to page</label>
                <input
                  id="browse-all-page-jump"
                  type="number"
                  min={1}
                  max={data.totalPages}
                  value={pageInputOverride ?? String(data.page)}
                  onChange={(e) => setPageInputOverride(e.target.value)}
                  disabled={loading}
                  className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-center text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="cursor-pointer rounded-full border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Go
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
