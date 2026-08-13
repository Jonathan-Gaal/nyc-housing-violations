"use client";

import { useState } from "react";
import BuildingCard from "@/components/BuildingCard";
import type { PaginatedBuildings } from "@/lib/queries";

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

export default function AllBuildingsBrowser({ zip }: { zip: string }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<PaginatedBuildings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPage(page: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/buildings/all?zip=${encodeURIComponent(zip)}&page=${page}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load buildings");
      setData(json);
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

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
      <button
        onClick={toggle}
        className="flex w-full cursor-pointer items-center justify-between gap-4 bg-blue-600 px-5 py-4 text-left transition-colors hover:bg-blue-700"
      >
        <span className="flex items-center gap-2.5 text-sm font-bold text-white">
          <ListIcon />
          Browse all buildings in {zip}
          {data ? ` (${data.totalBuildings})` : ""}
        </span>
        <ChevronIcon open={expanded} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3">
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
              <div className="flex flex-col gap-3">
                {data.buildings.map((b) => (
                  <BuildingCard key={b.building_id} building={b} />
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between text-sm">
                <button
                  onClick={() => loadPage(data.page - 1)}
                  disabled={data.page <= 1 || loading}
                  className="cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-slate-500">
                  Page {data.page} of {data.totalPages}
                </span>
                <button
                  onClick={() => loadPage(data.page + 1)}
                  disabled={data.page >= data.totalPages || loading}
                  className="cursor-pointer rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
