"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import type { ViolationRow } from "@/lib/queries";
import { buildViolationTimelineData } from "@/lib/violationTimelineData";

// Registered once at module load — required by Chart.js 4's tree-shakeable
// API before any <Bar> can render. This module itself is dynamically
// imported at the call site (BuildingCard.tsx, via next/dynamic with
// ssr: false), matching Phase 6's "heavy library, defer loading" handling
// of Mapbox GL in MapView.tsx — so this registration cost is only paid once
// a building card is actually expanded, not on initial page load.
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const OPEN_COLOR = "#f59e0b"; // amber-500
const CLOSED_COLOR = "#10b981"; // emerald-500
const REISSUED_COLOR = "#ef4444"; // red-500

const CHART_OPTIONS: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { stacked: true },
    y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
  },
  plugins: {
    legend: { position: "bottom" },
    tooltip: { mode: "index", intersect: false },
  },
};

export default function ViolationTimeline({ violations }: { violations: ViolationRow[] }) {
  const timelineData = useMemo(() => buildViolationTimelineData(violations), [violations]);

  if (timelineData.buckets.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-500">
        No violation history to chart{timelineData.excludedCount > 0 ? " (dates unavailable)" : ""}.
      </p>
    );
  }

  const chartData: ChartData<"bar"> = {
    labels: timelineData.buckets.map((bucket) => bucket.label),
    datasets: [
      {
        label: "Open",
        data: timelineData.buckets.map((bucket) => bucket.open),
        backgroundColor: OPEN_COLOR,
      },
      {
        label: "Closed",
        data: timelineData.buckets.map((bucket) => bucket.closed),
        backgroundColor: CLOSED_COLOR,
      },
      {
        label: "Reissued",
        data: timelineData.buckets.map((bucket) => bucket.reissued),
        backgroundColor: REISSUED_COLOR,
      },
    ],
  };

  return (
    <div className="mb-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Violation Timeline {timelineData.collapsedToYearBuckets ? "(by year)" : "(by month)"}
      </h4>
      <div style={{ height: 220 }}>
        <Bar data={chartData} options={CHART_OPTIONS} />
      </div>
      {timelineData.excludedCount > 0 && (
        <p className="mt-1 text-xs text-slate-400">
          {timelineData.excludedCount} violation{timelineData.excludedCount === 1 ? "" : "s"} excluded
          (missing inspection date).
        </p>
      )}
    </div>
  );
}
