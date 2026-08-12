import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  calculateScore,
  computeAvgYearsOpenComponent,
  computePercentDeadEndComponent,
  computePercentReissuedComponent,
  computeRentImpairingComponent,
  computeTotalViolationsComponent,
} from './scoring';
import { getPool, isDatabaseUrlPlaceholder } from './pgClient';
import { loadIntoDb } from './loadIntoDb';
import { getZipSummaryAndTopBuildings } from './queries';
import type { RawViolationRow } from './csvLoader';

// specs/007-scoring-new-formulas.md: per-component formulas come from
// context/product/open-violation-product-spec.md §4.2 (still accurate).
// The combining formula (score = 100 - weightedSum) is a human-confirmed
// correction of that same doc's internally-inconsistent §4.1/§4.3 text — see
// the file-header comment in scoring.ts for the full arithmetic proof. The
// doc's specific "28" end-to-end worked example in §4.3 is a known
// source-doc arithmetic error (neither the literal weighted sum, ~44, nor
// 100 minus that sum, 56, reconciles with the doc's own sample "score": 28
// for the same inputs) and is INTENTIONALLY NOT reproduced here or used as
// a test fixture — see specs/007's Objective section. Do not "fix" this
// suite to chase 28.
describe('per-component formulas (product-spec §4.2 worked examples)', () => {
  it('Factor 1: 45 violations, max 200 in zip -> component1 = 22.5', () => {
    expect(computeTotalViolationsComponent(45, 200)).toBe(22.5);
  });

  it('Factor 2: 45 total, 18 rent-impairing -> component2 = 40', () => {
    expect(computeRentImpairingComponent(18, 45)).toBe(40);
  });

  it('Factor 3: avg 2000 days (~5.48 years) -> component3 ≈ 68.5', () => {
    const avgYearsOpen = 2000 / 365.25;
    expect(computeAvgYearsOpenComponent(avgYearsOpen)).toBeCloseTo(68.5, 0);
  });

  it('Factor 4: 45 total, 35 dead-end -> component4 ≈ 77.8', () => {
    // percentDeadEnd is already a 0-100 percentage from the loader
    // (web/lib/csvLoader.ts), so this fixture pre-computes (35/45)x100 as
    // the input, matching what csvLoader actually hands to calculateScore.
    const percentDeadEnd = (35 / 45) * 100;
    expect(computePercentDeadEndComponent(percentDeadEnd)).toBeCloseTo(77.8, 1);
  });

  it('Factor 5: 45 total, 9 reissued -> component5 = 20', () => {
    const percentReissued = (9 / 45) * 100;
    expect(computePercentReissuedComponent(percentReissued)).toBe(20);
  });

  it('Factor 4/5 are NOT double-divided: an already-percentage input passes through unchanged', () => {
    // specs/007 Constraints: percentDeadEnd/percentReissued are already
    // percentages (0-100) from the loader — confirms (count/total)x100 is
    // not re-applied on top of an already-percentage value.
    expect(computePercentDeadEndComponent(40)).toBe(40);
    expect(computePercentReissuedComponent(10)).toBe(10);
  });

  it('Factor 1 guards maxViolationsInZip = 0 (divide-by-zero) -> 0, not NaN/Infinity', () => {
    const component1 = computeTotalViolationsComponent(45, 0);
    expect(component1).toBe(0);
    expect(Number.isFinite(component1)).toBe(true);
  });

  it('Factor 2 guards totalViolations = 0 (divide-by-zero) -> 0, not NaN/Infinity', () => {
    const component2 = computeRentImpairingComponent(0, 0);
    expect(component2).toBe(0);
    expect(Number.isFinite(component2)).toBe(true);
  });

  it('Factor 3 caps avg years open at 8 years -> component3 = 100', () => {
    expect(computeAvgYearsOpenComponent(20)).toBe(100);
  });
});

describe('calculateScore (corrected combining formula: score = 100 - weightedSum)', () => {
  it('all five components at 0 (no violations relative to zip max, 0% everything) -> score = 100', () => {
    const { score } = calculateScore({
      violationCount: 0,
      rentImpairingCount: 0,
      avgDaysOpen: 0,
      percentDeadEnd: 0,
      percentReissued: 0,
      maxViolationsInZip: 100,
    });
    expect(score).toBe(100);
  });

  it('all five components maxed at 100 -> score = 0', () => {
    const { score } = calculateScore({
      violationCount: 100,
      rentImpairingCount: 100, // rentImpairingCount === violationCount -> 100%
      avgDaysOpen: 8 * 365.25, // exactly at the 8-year cap
      percentDeadEnd: 100,
      percentReissued: 100,
      maxViolationsInZip: 100, // violationCount === maxViolationsInZip -> 100%
    });
    expect(score).toBe(0);
  });

  it('clamps score to [0, 100] even if weightedSum overshoots via floating point', () => {
    const { score } = calculateScore({
      violationCount: 1000,
      rentImpairingCount: 1000,
      avgDaysOpen: 100 * 365.25,
      percentDeadEnd: 100,
      percentReissued: 100,
      maxViolationsInZip: 1,
    });
    expect(score).toBe(0);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('breakdown reports unscaled values, including converting days to years', () => {
    const { breakdown } = calculateScore({
      violationCount: 45,
      rentImpairingCount: 3,
      avgDaysOpen: 1168, // ~3.2 years
      percentDeadEnd: 40,
      percentReissued: 10,
      maxViolationsInZip: 200,
    });
    expect(breakdown.totalViolations).toBe(45);
    expect(breakdown.rentImpairing).toBe(3);
    expect(breakdown.avgYearsOpen).toBe(3.2);
    expect(breakdown.percentDeadEnd).toBe(40);
    expect(breakdown.percentReissued).toBe(10);
  });

  it('never returns more than one decimal place', () => {
    const { score } = calculateScore({
      violationCount: 7,
      rentImpairingCount: 2,
      avgDaysOpen: 130,
      percentDeadEnd: 12,
      percentReissued: 5,
      maxViolationsInZip: 50,
    });
    expect(score).toBe(Math.round(score * 10) / 10);
  });

  it('worked-example inputs (product-spec §4.2) combine to a score between 0 and 100, not the doc\'s own inconsistent "28"', () => {
    // This intentionally does NOT assert score === 28 or score === 56 — see
    // this file's top-of-file comment and specs/007's Objective section for
    // why the doc's own end-to-end number is unreachable and not a valid
    // fixture. This test only proves the combining step stays in-range for
    // realistic per-component inputs.
    const { score } = calculateScore({
      violationCount: 45,
      rentImpairingCount: 18,
      avgDaysOpen: 2000,
      percentDeadEnd: (35 / 45) * 100,
      percentReissued: (9 / 45) * 100,
      maxViolationsInZip: 200,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// Phase 3's fixed-range formula, reimplemented inline (not imported — Phase
// 3's code no longer exists in scoring.ts) purely so this regression test
// can diff against it. Copied verbatim from scoring.ts's git history
// (pre-specs/007) — same shape as scoring.test.ts's prior
// rescale-equivalence test's inline-old-formula pattern.
function calculatePhase3Score(input: {
  violationCount: number;
  rentImpairingCount: number;
  avgDaysOpen: number;
  percentDeadEnd: number;
  percentReissued: number;
}): number {
  const SCORE_CEILING = 100;
  const POINT_BUDGET = {
    totalViolations: 0.25 * SCORE_CEILING,
    rentImpairing: 0.25 * SCORE_CEILING,
    avgYearsOpen: 0.2 * SCORE_CEILING,
    percentDeadEnd: 0.15 * SCORE_CEILING,
    percentReissued: 0.15 * SCORE_CEILING,
  };
  const avgYearsOpen = input.avgDaysOpen / 365.25;
  const deduction =
    Math.min(input.violationCount / 100, 1) * POINT_BUDGET.totalViolations +
    Math.min(input.rentImpairingCount / 40, 1) * POINT_BUDGET.rentImpairing +
    Math.min(avgYearsOpen / 8, 1) * POINT_BUDGET.avgYearsOpen +
    Math.min(input.percentDeadEnd / 100, 1) * POINT_BUDGET.percentDeadEnd +
    Math.min(input.percentReissued / 100, 1) * POINT_BUDGET.percentReissued;
  return Math.round(Math.max(0, Math.min(SCORE_CEILING, SCORE_CEILING - deduction)) * 10) / 10;
}

// specs/007-scoring-new-formulas.md Verification Oracle #3: load real zip
// 11106 data through both Phase 3's formula and this spec's new formula,
// and make the top-10 ordering diff visible rather than silently accepted.
// jazz's audit already established the per-component formula change can
// legitimately reorder buildings even with consistent polarity — this test
// exists to force a human to look at that diff, not to assert the two
// orderings are identical.
//
// Runs against the real Supabase Postgres instance (same skip rationale as
// loadIntoDb.test.ts/queries.test.ts) — skipped, not failed, while
// DATABASE_URL is still the web/.env.example placeholder.
const databaseUrlIsPlaceholder = isDatabaseUrlPlaceholder(process.env.DATABASE_URL);

describe.skipIf(databaseUrlIsPlaceholder)(
  'ranking-diff regression: Phase 3 vs Phase 7 (specs/007) top-10 ordering for zip 11106',
  () => {
    let pool: Pool;

    beforeAll(() => {
      pool = getPool();
    });

    afterAll(async () => {
      await pool.end();
    });

    // SIGN-OFF (human review required before merge): the new-formula top-10
    // ordering for zip 11106 below was reviewed against the Phase 3 ordering
    // printed by this test's console.table diff and is accepted as a real
    // consequence of implementing product-spec §4.2's documented formulas
    // (percentage-of-total + max-in-zip normalization), not a bug. See
    // specs/007-scoring-new-formulas.md Verification Oracle #3 and
    // Intellectual Control. [PENDING: reviewer name/date to be filled in by
    // the human sign-off step before this spec is marked done.]
    it('loads zip 11106 through both formulas and prints an explicit top-10 diff for human sign-off', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const { parse } = await import('csv-parse/sync');

      await pool.query('TRUNCATE TABLE violations, buildings RESTART IDENTITY CASCADE');

      const csvPath = path.join(
        process.cwd(),
        '..',
        'data',
        'Housing_Maintenance_Code_Violations_20260803.csv'
      );
      const content = fs.readFileSync(csvPath, 'utf-8');
      const allRows: RawViolationRow[] = parse(content, { columns: true, skip_empty_lines: true });
      const zip11106Rows = allRows.filter((r) => r.Postcode === '11106');

      // New formula (this spec): load through the real loader, which now
      // threads maxViolationsInZip through calculateScore.
      await loadIntoDb(pool, zip11106Rows);
      const { topBuildings: newFormulaTopBuildings } = await getZipSummaryAndTopBuildings(
        pool,
        '11106'
      );
      const newFormulaOrdering = newFormulaTopBuildings.map((b) => b.building_id);

      // Phase 3 formula: recompute in-memory from the same aggregated
      // buildings (via aggregateBuildings, imported dynamically to avoid an
      // unused top-level import when this suite is skipped), sorted the
      // same way getZipSummaryAndTopBuildings orders (score ascending =
      // worst first, since Phase 3's `rating` and this spec's `score` are
      // both "lower = worse").
      const { aggregateBuildings } = await import('./csvLoader');
      const { buildings } = aggregateBuildings(zip11106Rows);
      const phase3Ordering = buildings
        .map((b) => ({
          building_id: b.building_id,
          score: calculatePhase3Score({
            violationCount: b.violation_count,
            rentImpairingCount: b.rent_impairing_count,
            avgDaysOpen: b.avg_days_open,
            percentDeadEnd: b.percent_dead_end,
            percentReissued: b.percent_reissued,
          }),
        }))
        .sort((a, b) => a.score - b.score || 0)
        .slice(0, 10)
        .map((b) => b.building_id);

      // Explicit, visible diff in test output — this is the sign-off
      // artifact a human reviews, not a silent pass/fail.
      console.log('[specs/007 ranking-diff] Phase 3 top-10 (zip 11106):', phase3Ordering);
      console.log('[specs/007 ranking-diff] Phase 7 top-10 (zip 11106):', newFormulaOrdering);
      console.log(
        '[specs/007 ranking-diff] orderings identical:',
        JSON.stringify(phase3Ordering) === JSON.stringify(newFormulaOrdering)
      );

      // Not required to be identical (jazz's audit already established they
      // legitimately differ) — only required to both be well-formed top-10
      // (or fewer) orderings so the diff above is meaningful.
      expect(phase3Ordering.length).toBeGreaterThan(0);
      expect(phase3Ordering.length).toBeLessThanOrEqual(10);
      expect(newFormulaOrdering.length).toBeGreaterThan(0);
      expect(newFormulaOrdering.length).toBeLessThanOrEqual(10);
    });
  }
);
