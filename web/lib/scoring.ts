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
// as point-budgets, not fractions of 1, are unchanged. This spec does NOT
// change the per-factor formulas themselves (see specs/007 for that).
const SCORE_CEILING = 100;

const POINT_BUDGET = {
  totalViolations: 0.25 * SCORE_CEILING, // 25 — count scaled 0-1 on a 0-100 violation range
  rentImpairing: 0.25 * SCORE_CEILING, // 25 — count scaled 0-1 on a 0-40 rent-impairing range
  avgYearsOpen: 0.2 * SCORE_CEILING, // 20 — years scaled 0-1 on a 0-8 year range
  percentDeadEnd: 0.15 * SCORE_CEILING, // 15 — % scaled 0-1 over 0-100%
  percentReissued: 0.15 * SCORE_CEILING, // 15 — % scaled 0-1 over 0-100%
};

const DAYS_PER_YEAR = 365.25;

export interface ScoringInput {
  violationCount: number;
  rentImpairingCount: number;
  avgDaysOpen: number;
  percentDeadEnd: number; // 0-100
  percentReissued: number; // 0-100
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

export function calculateScore({
  violationCount,
  rentImpairingCount,
  avgDaysOpen,
  percentDeadEnd,
  percentReissued,
}: ScoringInput): ScoringResult {
  const avgYearsOpen = avgDaysOpen / DAYS_PER_YEAR;

  const deduction =
    Math.min(violationCount / 100, 1) * POINT_BUDGET.totalViolations +
    Math.min(rentImpairingCount / 40, 1) * POINT_BUDGET.rentImpairing +
    Math.min(avgYearsOpen / 8, 1) * POINT_BUDGET.avgYearsOpen +
    Math.min(percentDeadEnd / 100, 1) * POINT_BUDGET.percentDeadEnd +
    Math.min(percentReissued / 100, 1) * POINT_BUDGET.percentReissued;

  const score =
    Math.round(
      Math.max(0, Math.min(SCORE_CEILING, SCORE_CEILING - deduction)) * 10
    ) / 10;

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
