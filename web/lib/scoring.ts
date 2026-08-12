// Deterministic building score (US-5, user_stories.md; composite formula
// from specs/001-zip-search-and-buildings-summary.md). Never LLM-generated —
// see the Bounded-AI boundary in ../CLAUDE.md.
//
// Spec note: specs/001 writes the formula as
//   score = 5 - (scaled*0.25 + scaled*0.25 + scaled*0.20 + scaled*0.15 + scaled*0.15)
// with each `scaled` factor in [0,1]. Those weights sum to 1.0, so the
// deduction can only ever reach 1.0 — every building would score 4.0-5.0,
// never lower, which contradicts the spec's own "0-5 scale" framing and its
// per-factor "= 1 point deduction" language (5 factors x 1 point = 5, the
// range needed to reach 0). Resolved (human decision, 2026-08-11): treat the
// weights as point-budgets out of 5, not fractions of 1 — each factor's
// weight x 5 is its own point cap. Sums to exactly 5, so a maxed-out
// building can hit 0, and it preserves the full 0-5 spread the rating-tier
// UI (lib/format.ts) is calibrated for.
//
// Rescale note (specs/006-scoring-rescale-0-100.md, 2026-08-12): the score
// ceiling moved from 5 to 100 (a plain x20 linear rescale) so the UI can
// present a 0-100 score. The point-budget structure above is preserved
// exactly, just re-based on SCORE_CEILING instead of a literal 5 — the
// underlying weight fractions (0.25/0.25/0.20/0.15/0.15) and their meaning
// as point-budgets, not fractions of 1, are unchanged. specs/006 did NOT
// change the per-factor formulas themselves.
//
// Formula rewrite (specs/007-scoring-new-formulas.md, 2026-08-12): the
// per-factor math above (fixed-range point-budget scaling) is replaced by
// context/product/open-violation-product-spec.md §4.2's five documented
// per-component formulas — percentage-of-total for rent-impairing/dead-end/
// reissued, max-in-zip normalization for total-violations, and a
// capped-ratio for avg-years-open. See computeTotalViolationsComponent,
// computeRentImpairingComponent, computeAvgYearsOpenComponent,
// computePercentDeadEndComponent, and computePercentReissuedComponent below.
//
// Combining-formula correction (human-confirmed, specs/007 Objective/§source-
// doc-arithmetic-error): product-spec §4.1 states the combining formula as a
// literal weighted sum, but that same document's own §4.3 worked example
// applies its own §4.2 per-component numbers (22.5, 40, 68.5, 77.8, 20) to
// that literal formula and gets ~44, yet the doc's own sample JSON for that
// identical building shows "score": 28. Neither 44 nor 100-44=56 reconciles
// with 28 — the doc's own worked-example arithmetic is internally
// inconsistent. This codebase implements score = 100 - weightedSum instead
// of the literal weightedSum, because that is the only reading consistent
// with (a) the doc's own polarity statement ("lower = worse landlord",
// §4.1), (b) its interpretation table (0-20 = chronic non-compliance = high
// weightedSum of bad-factor scores, 81-100 = exemplary = low weightedSum),
// and (c) it mirrors this codebase's already-approved formula shape
// (5 - deduction, rescaled x20 by specs/006). The doc's specific "28"
// end-to-end worked example is a known source-doc arithmetic error and is
// intentionally NOT reproduced or used as a test fixture — see
// specs/007-scoring-new-formulas.md for the full resolution.
const SCORE_CEILING = 100;

const WEIGHT = {
  totalViolations: 0.25,
  rentImpairing: 0.25,
  avgYearsOpen: 0.2,
  percentDeadEnd: 0.15,
  percentReissued: 0.15,
};

const DAYS_PER_YEAR = 365.25;

// product-spec §4.2 Factor 3: capped at 8 years = 100% component penalty.
const AVG_YEARS_OPEN_CAP = 8;

export interface ScoringInput {
  violationCount: number;
  rentImpairingCount: number;
  avgDaysOpen: number;
  percentDeadEnd: number; // 0-100
  percentReissued: number; // 0-100
  // product-spec §4.2 Factor 1: (total_violations / max_violations_in_zip) x 100.
  // Required (not optional) so a caller can't silently skip Factor 1's
  // normalization — see specs/007 Type Constraints.
  //
  // NOTE (specs/007 Constraints): this must be computed per-zip at load
  // time, not hardcoded or cached stale. A building's Factor-1 component
  // changes if other buildings in its zip gain/lose violations — this is
  // real product behavior (product-spec's own Factor-1 definition), not a
  // bug. Do not "fix" this into a fixed-range scale again.
  maxViolationsInZip: number;
}

export interface ScoringBreakdown {
  totalViolations: number;
  rentImpairing: number;
  avgYearsOpen: number;
  percentDeadEnd: number;
  percentReissued: number;
}

export interface ScoringResult {
  score: number;
  breakdown: ScoringBreakdown;
}

// Factor 1 (25%): total violations normalized against the max in the same
// zip. Guards maxViolationsInZip === 0 (divide-by-zero) per specs/007 Edge
// Cases — returns 0 rather than NaN/Infinity. In practice this is
// unreachable (a building needs >=1 violation to exist in a query result,
// and it is itself counted in the zip's max), but the guard is defensive.
export function computeTotalViolationsComponent(
  violationCount: number,
  maxViolationsInZip: number
): number {
  if (maxViolationsInZip <= 0) return 0;
  return (violationCount / maxViolationsInZip) * 100;
}

// Factor 2 (25%): percent of a building's violations that are rent-impairing.
// Guards totalViolations === 0 (divide-by-zero) per specs/007 Edge Cases.
export function computeRentImpairingComponent(
  rentImpairingCount: number,
  totalViolations: number
): number {
  if (totalViolations <= 0) return 0;
  return (rentImpairingCount / totalViolations) * 100;
}

// Factor 3 (20%): average years open, capped at AVG_YEARS_OPEN_CAP so
// buildings with violations stuck open beyond the cap all score the same.
export function computeAvgYearsOpenComponent(avgYearsOpen: number): number {
  return Math.min(avgYearsOpen / AVG_YEARS_OPEN_CAP, 1) * 100;
}

// Factor 4 (15%): percent of violations in dead-end statuses. percentDeadEnd
// is already a 0-100 percentage from the loader (web/lib/csvLoader.ts) — this
// is percentage-*of-violations*, i.e. already the finished component value,
// NOT a raw count that needs (count/total)x100 applied again. Applying
// (count/total)x100 to an already-percentage input would double-scale it
// (specs/007 Constraints flags this as the most likely single copy-paste
// bug in this spec) — so this function is intentionally an identity/no-op,
// documented rather than silently inlined at the call site.
export function computePercentDeadEndComponent(percentDeadEnd: number): number {
  return percentDeadEnd;
}

// Factor 5 (15%): percent of violations reissued. Same already-a-percentage
// input shape as computePercentDeadEndComponent above — see that function's
// comment for why this is an identity, not a re-division.
export function computePercentReissuedComponent(percentReissued: number): number {
  return percentReissued;
}

export function calculateScore({
  violationCount,
  rentImpairingCount,
  avgDaysOpen,
  percentDeadEnd,
  percentReissued,
  maxViolationsInZip,
}: ScoringInput): ScoringResult {
  const avgYearsOpen = avgDaysOpen / DAYS_PER_YEAR;

  const component1 = computeTotalViolationsComponent(violationCount, maxViolationsInZip);
  const component2 = computeRentImpairingComponent(rentImpairingCount, violationCount);
  const component3 = computeAvgYearsOpenComponent(avgYearsOpen);
  const component4 = computePercentDeadEndComponent(percentDeadEnd);
  const component5 = computePercentReissuedComponent(percentReissued);

  const weightedSum =
    component1 * WEIGHT.totalViolations +
    component2 * WEIGHT.rentImpairing +
    component3 * WEIGHT.avgYearsOpen +
    component4 * WEIGHT.percentDeadEnd +
    component5 * WEIGHT.percentReissued;

  // Corrected combining formula (see file-header note above): 100 minus the
  // weighted sum of "badness" components, not the literal weighted sum.
  // Clamped to [0, 100] to absorb any floating-point overshoot near the
  // boundaries (specs/007 Edge Cases).
  const score =
    Math.round(Math.max(0, Math.min(SCORE_CEILING, SCORE_CEILING - weightedSum)) * 10) / 10;

  return {
    score,
    breakdown: {
      totalViolations: violationCount,
      rentImpairing: rentImpairingCount,
      avgYearsOpen: Math.round(avgYearsOpen * 10) / 10,
      percentDeadEnd: Math.round(percentDeadEnd * 10) / 10,
      percentReissued: Math.round(percentReissued * 10) / 10,
    },
  };
}
