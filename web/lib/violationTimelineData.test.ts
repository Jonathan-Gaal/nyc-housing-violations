import { describe, expect, it } from "vitest";
import { buildViolationTimelineData } from "./violationTimelineData";
import type { ViolationRow } from "./queries";

// Minimal ViolationRow fixture factory — only the fields
// buildViolationTimelineData reads are meaningfully varied per-test; the
// rest are stable filler matching this codebase's real column shapes
// (web/lib/queries.ts).
function makeViolation(overrides: Partial<ViolationRow> & { violation_id: string }): ViolationRow {
  return {
    house_number: "123",
    street_name: "Main St",
    inspection_date: "2026-01-01",
    current_status: "NOV SENT OUT",
    violation_status: "Open",
    rent_impairing: 0,
    nov_description: "Test violation",
    nov_type: "HEAT",
    days_open: 10,
    ...overrides,
  };
}

describe("buildViolationTimelineData", () => {
  it("5 violations across 3 months, 2 closed, 1 reissued -> correct per-bucket counts", () => {
    // Fixture (per spec's Test Constraints worked example):
    // - Jan: 2 violations, both HEAT (first occurrence -> open; second
    //   occurrence of the same nov_type -> reissued)
    // - Feb: 2 violations, both "Closed" violation_status, different nov_types
    //   (first occurrences of their own type -> closed, not reissued)
    // - Mar: 1 violation, "Open" violation_status, distinct nov_type -> open
    // Totals: open=2 (Jan first HEAT + Mar), closed=2 (Feb), reissued=1 (Jan second HEAT).
    const violations: ViolationRow[] = [
      makeViolation({
        violation_id: "1",
        inspection_date: "2026-01-05",
        violation_status: "Open",
        nov_type: "HEAT",
      }),
      makeViolation({
        violation_id: "2",
        inspection_date: "2026-01-20",
        violation_status: "Open",
        nov_type: "HEAT", // re-occurrence of HEAT after the Jan 5 first occurrence
      }),
      makeViolation({
        violation_id: "3",
        inspection_date: "2026-02-10",
        violation_status: "Closed",
        nov_type: "PLUMBING",
      }),
      makeViolation({
        violation_id: "4",
        inspection_date: "2026-02-15",
        violation_status: "Closed",
        nov_type: "PAINT",
      }),
      makeViolation({
        violation_id: "5",
        inspection_date: "2026-03-01",
        violation_status: "Open",
        nov_type: "ELEVATOR",
      }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.excludedCount).toBe(0);
    expect(result.collapsedToYearBuckets).toBe(false);
    expect(result.buckets).toEqual([
      { label: "2026-01", open: 1, closed: 0, reissued: 1, total: 2 },
      { label: "2026-02", open: 0, closed: 2, reissued: 0, total: 2 },
      { label: "2026-03", open: 1, closed: 0, reissued: 0, total: 1 },
    ]);

    const totalOpen = result.buckets.reduce((sum, b) => sum + b.open, 0);
    const totalClosed = result.buckets.reduce((sum, b) => sum + b.closed, 0);
    const totalReissued = result.buckets.reduce((sum, b) => sum + b.reissued, 0);
    expect(totalClosed).toBe(2);
    expect(totalReissued).toBe(1);
    expect(totalOpen + totalClosed + totalReissued).toBe(5);
  });

  it("buckets are sorted chronologically by label", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "2026-03-01", nov_type: "A" }),
      makeViolation({ violation_id: "2", inspection_date: "2026-01-01", nov_type: "B" }),
      makeViolation({ violation_id: "3", inspection_date: "2026-02-01", nov_type: "C" }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.buckets.map((b) => b.label)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("single violation -> a single-bucket result, not an error", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "2026-06-15", violation_status: "Open" }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.buckets).toEqual([
      { label: "2026-06", open: 1, closed: 0, reissued: 0, total: 1 },
    ]);
    expect(result.excludedCount).toBe(0);
  });

  it("empty violations array -> no buckets, no error", () => {
    const result = buildViolationTimelineData([]);

    expect(result.buckets).toEqual([]);
    expect(result.excludedCount).toBe(0);
    expect(result.collapsedToYearBuckets).toBe(false);
  });

  it("missing/null inspection_date -> excluded from bucketing, not miscounted into a bucket", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "2026-01-10" }),
      makeViolation({
        violation_id: "2",
        // Simulates a null/missing date arriving at runtime despite the
        // string type — defensive against real-world data gaps.
        inspection_date: null as unknown as string,
      }),
      makeViolation({ violation_id: "3", inspection_date: "" }),
      makeViolation({ violation_id: "4", inspection_date: "not-a-date" }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.excludedCount).toBe(3);
    expect(result.buckets).toEqual([{ label: "2026-01", open: 1, closed: 0, reissued: 0, total: 1 }]);
  });

  it("all violations have unparseable dates -> empty buckets, all excluded, no crash", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "garbage" }),
      makeViolation({ violation_id: "2", inspection_date: "" }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.buckets).toEqual([]);
    expect(result.excludedCount).toBe(2);
    expect(result.collapsedToYearBuckets).toBe(false);
  });

  it("wide date range (>24 months) collapses to year-buckets, current non-degraded month-bucketing still verified above for normal ranges", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "2020-01-15", nov_type: "A" }),
      makeViolation({ violation_id: "2", inspection_date: "2021-06-15", nov_type: "B" }),
      makeViolation({ violation_id: "3", inspection_date: "2023-12-15", nov_type: "C" }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.collapsedToYearBuckets).toBe(true);
    expect(result.buckets.map((b) => b.label)).toEqual(["2020", "2021", "2023"]);
    expect(result.buckets.reduce((sum, b) => sum + b.total, 0)).toBe(3);
  });

  it("date range at exactly the 24-month threshold does NOT collapse (boundary is exclusive)", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "2024-01-15", nov_type: "A" }),
      makeViolation({ violation_id: "2", inspection_date: "2026-01-15", nov_type: "B" }), // exactly 24 months later
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.collapsedToYearBuckets).toBe(false);
    expect(result.buckets.map((b) => b.label)).toEqual(["2024-01", "2026-01"]);
  });

  it("date range just over the 24-month threshold DOES collapse", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "2024-01-15", nov_type: "A" }),
      makeViolation({ violation_id: "2", inspection_date: "2026-02-15", nov_type: "B" }), // 25 months later
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.collapsedToYearBuckets).toBe(true);
    expect(result.buckets.map((b) => b.label)).toEqual(["2024", "2026"]);
  });

  it("a reissued violation is classified as reissued even when its violation_status is Open", () => {
    const violations: ViolationRow[] = [
      makeViolation({
        violation_id: "1",
        inspection_date: "2026-01-01",
        violation_status: "Open",
        nov_type: "HEAT",
      }),
      makeViolation({
        violation_id: "2",
        inspection_date: "2026-01-15",
        violation_status: "Open",
        nov_type: "HEAT",
      }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.buckets).toEqual([
      { label: "2026-01", open: 1, closed: 0, reissued: 1, total: 2 },
    ]);
  });

  it("same-day-tie reissuance: 3 rows sharing a nov_type, 2 tied on the earliest date, 1 later -> 2 reissued (matches csvLoader.ts's date-independent 'group size minus one', not a strict date > filter)", () => {
    // Regression for the bug ratchet's Mode 2 review caught: a strict
    // `inspection_date > firstOccurrenceDate` filter would exempt BOTH
    // same-day-tied rows (neither's date is strictly greater than the
    // other's), undercounting reissued as 1 instead of 2. csvLoader.ts's
    // building-level percent_reissued is date-independent — group size (3)
    // minus distinct nov_type count (1 group) = 2 reissued, regardless of
    // which row within the tie is picked as the exempt one. This fixture
    // asserts that correct count.
    const violations: ViolationRow[] = [
      makeViolation({
        violation_id: "1",
        inspection_date: "2026-01-05",
        violation_status: "Open",
        nov_type: "PAINT",
      }),
      makeViolation({
        violation_id: "2",
        inspection_date: "2026-01-05", // tied with violation 1 on the earliest date
        violation_status: "Open",
        nov_type: "PAINT",
      }),
      makeViolation({
        violation_id: "3",
        inspection_date: "2026-01-20", // later re-occurrence of the same nov_type
        violation_status: "Open",
        nov_type: "PAINT",
      }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.buckets).toEqual([
      { label: "2026-01", open: 1, closed: 0, reissued: 2, total: 3 },
    ]);
    const totalReissued = result.buckets.reduce((sum, b) => sum + b.reissued, 0);
    expect(totalReissued).toBe(2);
  });

  it("same-day-tie exempt-row choice is deterministic (violation_id tiebreak), regardless of input array order", () => {
    // Same fixture as above but with violation_id 1 and 2 swapped in input
    // order — the exempt row must still be chosen the same way (lowest
    // violation_id among the earliest-date rows), so the reissued count is
    // stable regardless of the order violations arrive from the API.
    const violations: ViolationRow[] = [
      makeViolation({
        violation_id: "2",
        inspection_date: "2026-01-05",
        violation_status: "Open",
        nov_type: "PAINT",
      }),
      makeViolation({
        violation_id: "1",
        inspection_date: "2026-01-05",
        violation_status: "Open",
        nov_type: "PAINT",
      }),
      makeViolation({
        violation_id: "3",
        inspection_date: "2026-01-20",
        violation_status: "Open",
        nov_type: "PAINT",
      }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.buckets).toEqual([
      { label: "2026-01", open: 1, closed: 0, reissued: 2, total: 3 },
    ]);
  });

  it("violation_status comparison is case-insensitive", () => {
    const violations: ViolationRow[] = [
      makeViolation({ violation_id: "1", inspection_date: "2026-01-01", violation_status: "OPEN" }),
      makeViolation({
        violation_id: "2",
        inspection_date: "2026-01-02",
        violation_status: "open",
        nov_type: "B",
      }),
    ];

    const result = buildViolationTimelineData(violations);

    expect(result.buckets[0].open).toBe(2);
  });
});
