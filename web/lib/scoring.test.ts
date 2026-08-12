import { describe, expect, it } from 'vitest';
import { calculateScore } from './scoring';

describe('calculateScore', () => {
  it('gives a perfect building a 100.0 (0-100 scale)', () => {
    const { score, breakdown } = calculateScore({
      violationCount: 0,
      rentImpairingCount: 0,
      avgDaysOpen: 0,
      percentDeadEnd: 0,
      percentReissued: 0,
    });
    expect(score).toBe(100);
    expect(breakdown).toEqual({
      totalViolations: 0,
      rentImpairing: 0,
      avgYearsOpen: 0,
      percentDeadEnd: 0,
      percentReissued: 0,
    });
  });

  it('gives the worst possible building a 0.0, never negative', () => {
    const { score } = calculateScore({
      violationCount: 1000,
      rentImpairingCount: 100,
      avgDaysOpen: 5000,
      percentDeadEnd: 100,
      percentReissued: 100,
    });
    expect(score).toBe(0);
  });

  it('clamps each factor at its cap instead of over-penalizing', () => {
    const atCap = calculateScore({
      violationCount: 100,
      rentImpairingCount: 0,
      avgDaysOpen: 0,
      percentDeadEnd: 0,
      percentReissued: 0,
    });
    const overCap = calculateScore({
      violationCount: 10000,
      rentImpairingCount: 0,
      avgDaysOpen: 0,
      percentDeadEnd: 0,
      percentReissued: 0,
    });
    expect(overCap.score).toBe(atCap.score);
    expect(atCap.score).toBe(75); // 100 - 25 (totalViolations point-budget maxed)
  });

  it('weights totalViolations and rentImpairing most heavily (25pt each)', () => {
    const violationsOnly = calculateScore({
      violationCount: 100,
      rentImpairingCount: 0,
      avgDaysOpen: 0,
      percentDeadEnd: 0,
      percentReissued: 0,
    });
    const deadEndOnly = calculateScore({
      violationCount: 0,
      rentImpairingCount: 0,
      avgDaysOpen: 0,
      percentDeadEnd: 100,
      percentReissued: 0,
    });
    expect(100 - violationsOnly.score).toBeGreaterThan(100 - deadEndOnly.score);
  });

  it('breakdown reports unscaled values, including converting days to years', () => {
    const { breakdown } = calculateScore({
      violationCount: 45,
      rentImpairingCount: 3,
      avgDaysOpen: 1168, // ~3.2 years
      percentDeadEnd: 40,
      percentReissued: 10,
    });
    expect(breakdown.totalViolations).toBe(45);
    expect(breakdown.rentImpairing).toBe(3);
    expect(breakdown.avgYearsOpen).toBe(3.2);
    expect(breakdown.percentDeadEnd).toBe(40);
    expect(breakdown.percentReissued).toBe(10);
  });

  it('sums all five point-budgets to exactly 100 at full deduction', () => {
    const { score } = calculateScore({
      violationCount: 100,
      rentImpairingCount: 40,
      avgDaysOpen: 8 * 365.25,
      percentDeadEnd: 100,
      percentReissued: 100,
    });
    expect(score).toBe(0);
  });

  it('never returns more than one decimal place', () => {
    const { score } = calculateScore({
      violationCount: 7,
      rentImpairingCount: 2,
      avgDaysOpen: 130,
      percentDeadEnd: 12,
      percentReissued: 5,
    });
    expect(score).toBe(Math.round(score * 10) / 10);
  });

  // specs/006-scoring-rescale-0-100.md — the rescale must be a pure x20 of
  // the prior 0-5 formula, not a new formula. This test recomputes the
  // pre-rescale (0-5) formula inline (not by importing old code) so it stays
  // self-contained, then asserts the new calculateScore output is exactly
  // 20x that value for the same fixture used in spec 001's real-data
  // spot-check: {45 violations, 3 rent-impairing, 1168 avg days open (~3.2
  // years), 40% dead-end, 10% reissued}.
  it('rescale-equivalence: new 0-100 score is exactly 20x the pre-rescale 0-5 score', () => {
    const input = {
      violationCount: 45,
      rentImpairingCount: 3,
      avgDaysOpen: 1168,
      percentDeadEnd: 40,
      percentReissued: 10,
    };

    const avgYearsOpen = input.avgDaysOpen / 365.25;
    const oldPointBudget = {
      totalViolations: 0.25 * 5,
      rentImpairing: 0.25 * 5,
      avgYearsOpen: 0.2 * 5,
      percentDeadEnd: 0.15 * 5,
      percentReissued: 0.15 * 5,
    };
    const oldDeduction =
      Math.min(input.violationCount / 100, 1) * oldPointBudget.totalViolations +
      Math.min(input.rentImpairingCount / 40, 1) * oldPointBudget.rentImpairing +
      Math.min(avgYearsOpen / 8, 1) * oldPointBudget.avgYearsOpen +
      Math.min(input.percentDeadEnd / 100, 1) * oldPointBudget.percentDeadEnd +
      Math.min(input.percentReissued / 100, 1) * oldPointBudget.percentReissued;

    // Raw (unrounded) pre-rescale score — this is the value that is
    // genuinely 1/20th of the new score. The *rounded-to-1-decimal*
    // pre-rescale score (3.6, what spec 001's oracle displays) is NOT
    // exactly 1/20th of the new rounded score, because rounding to 1
    // decimal place on a 0-5 scale (0.1 = 2% of range) is coarser than
    // rounding to 1 decimal place on a 0-100 scale (0.1 = 0.1% of range).
    // Double-rounding (round old, multiply, compare to round-new) is not a
    // valid equivalence check: 3.569 rounds to 3.6, and 3.6 * 20 = 72, but
    // the correctly-rescaled raw value 3.569 * 20 = 71.38 rounds to 71.4,
    // not 72. This test asserts equivalence on the raw (pre-round) score,
    // which is the mathematically correct x20 relationship, then confirms
    // calculateScore's own final rounding step is applied consistently.
    const oldScoreOnZeroToFiveRaw = Math.max(0, Math.min(5, 5 - oldDeduction));
    const oldScoreOnZeroToFiveRounded = Math.round(oldScoreOnZeroToFiveRaw * 10) / 10;

    expect(oldScoreOnZeroToFiveRounded).toBe(3.6); // spec 001's previously-verified 0-5 value

    const { score } = calculateScore(input);

    // The true rescale equivalence: raw old score x20, rounded the same way
    // calculateScore itself rounds (1 decimal place), on the 0-100 scale.
    const expectedNewScore = Math.round(oldScoreOnZeroToFiveRaw * 20 * 10) / 10;
    expect(score).toBe(expectedNewScore);
    expect(score).toBe(71.4);
  });

  // specs/006 Edge Cases: "the max score is now 100 not 5" is exactly the
  // off-by-factor-of-20 bug this rescale spec exists to catch.
  it('zero-violations boundary: all inputs 0 maps to score 100, not 5', () => {
    const { score } = calculateScore({
      violationCount: 0,
      rentImpairingCount: 0,
      avgDaysOpen: 0,
      percentDeadEnd: 0,
      percentReissued: 0,
    });
    expect(score).toBe(100);
    expect(score).not.toBe(5);
  });
});
