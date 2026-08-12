// Pure month-bucketing/counting for the building-detail violation timeline
// chart (specs/010-chartjs-violation-timeline.md). No LLM involvement in
// counting, bucketing, or labeling — see this project's Bounded-AI boundary
// in ../CLAUDE.md. Same "deterministic computation, separately testable from
// rendering" pattern as scoring.ts/format.ts.

import type { ViolationRow } from "./queries";

// This app's data snapshot (and its live-Socrata query, see
// context/API_INTEGRATION.md §"status filter is fixed") only ever loads
// violations where violation_status is OPEN — "closed" is not a value this
// codebase's data currently produces at the per-row level. This function
// still classifies defensively on violation_status so a future data source
// with real CLOSED rows buckets correctly without a rewrite here.
const OPEN_VIOLATION_STATUS = "open";

export type TimelineViolationCategory = "open" | "closed" | "reissued";

export interface TimelineMonthBucket {
  // "YYYY-MM" (or "YYYY" once year-collapsed — see shouldCollapseToYearBuckets)
  // sort key and x-axis label are the same string for month buckets.
  label: string;
  open: number;
  closed: number;
  reissued: number;
  total: number;
}

export interface ViolationTimelineData {
  buckets: TimelineMonthBucket[];
  // Violations excluded from bucketing because inspection_date was
  // missing/unparseable (spec Edge Cases: "excluded ... logged, not
  // silently miscounted into a wrong bucket").
  excludedCount: number;
  // True when the date range spanned more than MAX_MONTHS_BEFORE_YEAR_COLLAPSE
  // months and buckets were collapsed to per-year granularity instead of
  // per-month, to keep the x-axis readable (spec Edge Cases).
  collapsedToYearBuckets: boolean;
}

// Spec Edge Cases: "collapse to year-buckets if the date range exceeds
// ~24 months" — implemented (not deferred). 24 monthly buckets is roughly
// the upper bound of what a bar/line x-axis can label without overlap on a
// typical building-detail card width.
const MAX_MONTHS_BEFORE_YEAR_COLLAPSE = 24;

function parseInspectionDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function monthLabel(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function yearLabel(date: Date): string {
  return String(date.getUTCFullYear());
}

function monthsBetween(a: Date, b: Date): number {
  return Math.abs(
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  );
}

// A violation is "reissued" when it is NOT the exempted (earliest) row within
// its building's nov_type group. This matches csvLoader.ts's building-level
// percent_reissued definition exactly: `violation_count - nov_type_counts.size`
// (line 173), i.e. "group size minus one" per nov_type, date-independent —
// NOT "any row whose date is strictly greater than the group's earliest
// date." Those two are NOT equivalent whenever 2+ rows in a nov_type group
// share the exact same earliest inspection_date (common in HPD data — one
// inspection often issues multiple same-type violations same-day across
// units): a strict-date-greater-than filter would incorrectly exempt every
// tied row, undercounting reissued. This function instead exempts exactly
// one row per group (via reissuedExemptViolationIdByNovType, built below)
// and classifies every other row in that group — including same-day ties
// beyond the first-exempted one — as reissued.
function classifyViolation(
  violation: ViolationRow,
  reissuedExemptViolationIdByNovType: Map<string, string>
): TimelineViolationCategory {
  const isOpen = violation.violation_status?.toLowerCase() === OPEN_VIOLATION_STATUS;
  const exemptViolationId = reissuedExemptViolationIdByNovType.get(violation.nov_type);
  const isReissued = exemptViolationId !== undefined && violation.violation_id !== exemptViolationId;

  if (isReissued) return "reissued";
  return isOpen ? "open" : "closed";
}

// Picks exactly one "exempt" (first-occurrence, not reissued) row per
// nov_type group — the earliest inspection_date, tie-broken by violation_id
// for a deterministic, stable choice when 2+ rows share the same earliest
// date. Every other row sharing that nov_type is then classified as
// reissued by classifyViolation, reproducing csvLoader.ts's date-independent
// "group size minus one" count per nov_type.
//
// Scope note: unlike csvLoader.ts (which counts every row regardless of
// whether inspection_date parses), this is called with only date-valid rows
// (buildViolationTimelineData filters unparseable dates out via
// validEntries first, per this spec's Edge Cases on excluded rows) — so a
// building with unparseable-date rows in a nov_type group can see a
// slightly lower reissued count here than csvLoader.ts's building-level
// percent_reissued for the same building. Acceptable scope difference, not
// required to reconcile (the timeline explicitly reports its own
// excludedCount alongside the chart).
function buildReissuedExemptViolationIdByNovType(violations: ViolationRow[]): Map<string, string> {
  const exemptViolationByNovType = new Map<string, ViolationRow>();
  for (const violation of violations) {
    if (!violation.nov_type) continue;
    const currentExempt = exemptViolationByNovType.get(violation.nov_type);
    if (
      currentExempt === undefined ||
      violation.inspection_date < currentExempt.inspection_date ||
      (violation.inspection_date === currentExempt.inspection_date &&
        violation.violation_id < currentExempt.violation_id)
    ) {
      exemptViolationByNovType.set(violation.nov_type, violation);
    }
  }
  return new Map(
    Array.from(exemptViolationByNovType.entries()).map(([novType, violation]) => [
      novType,
      violation.violation_id,
    ])
  );
}

// States what it computes: groups a building's violations into date buckets
// and counts open/closed/reissued per bucket, for ViolationTimeline.tsx to
// render as a Chart.js chart without doing any aggregation itself.
export function buildViolationTimelineData(violations: ViolationRow[]): ViolationTimelineData {
  const parsedByViolation = violations.map((violation) => ({
    violation,
    date: parseInspectionDate(violation.inspection_date),
  }));

  const validEntries = parsedByViolation.filter(
    (entry): entry is { violation: ViolationRow; date: Date } => entry.date !== null
  );
  const excludedCount = parsedByViolation.length - validEntries.length;

  if (validEntries.length === 0) {
    return { buckets: [], excludedCount, collapsedToYearBuckets: false };
  }

  const dates = validEntries.map((entry) => entry.date);
  const earliestDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const latestDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  const collapsedToYearBuckets =
    monthsBetween(earliestDate, latestDate) > MAX_MONTHS_BEFORE_YEAR_COLLAPSE;
  const labelFor = collapsedToYearBuckets ? yearLabel : monthLabel;

  const reissuedExemptViolationIdByNovType = buildReissuedExemptViolationIdByNovType(
    validEntries.map((entry) => entry.violation)
  );

  const bucketsByLabel = new Map<string, TimelineMonthBucket>();
  for (const { violation, date } of validEntries) {
    const label = labelFor(date);
    const bucket = bucketsByLabel.get(label) ?? { label, open: 0, closed: 0, reissued: 0, total: 0 };

    const category = classifyViolation(violation, reissuedExemptViolationIdByNovType);
    bucket[category] += 1;
    bucket.total += 1;

    bucketsByLabel.set(label, bucket);
  }

  const buckets = Array.from(bucketsByLabel.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  );

  return { buckets, excludedCount, collapsedToYearBuckets };
}
