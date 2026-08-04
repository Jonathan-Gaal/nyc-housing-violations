import { describe, expect, it } from 'vitest';
import { calculateRating } from './rating';

describe('calculateRating', () => {
  it('gives a perfect building a 5.0', () => {
    expect(
      calculateRating({ violationCount: 0, avgDaysOpen: 0, rentImpairingCount: 0 })
    ).toBe(5);
  });

  it('gives the worst possible building a 0.0, never negative', () => {
    expect(
      calculateRating({ violationCount: 500, avgDaysOpen: 5000, rentImpairingCount: 100 })
    ).toBe(0);
  });

  it('clamps each weight at its cap instead of over-penalizing', () => {
    // violationCount way past the 50-cap should score the same as exactly 50
    const atCap = calculateRating({ violationCount: 50, avgDaysOpen: 0, rentImpairingCount: 0 });
    const overCap = calculateRating({ violationCount: 5000, avgDaysOpen: 0, rentImpairingCount: 0 });
    expect(overCap).toBe(atCap);
    expect(atCap).toBe(3); // 5 - 2 (violation weight maxed) = 3
  });

  it('matches the documented worked example', () => {
    // violationWeight = min(50/50,1)*2 = 2; ageWeight = min(1000/2000,1)*2 = 1;
    // rentImpairingWeight = min(10/20,1)*1 = 0.5; score = 5 - 3.5 = 1.5
    expect(
      calculateRating({ violationCount: 50, avgDaysOpen: 1000, rentImpairingCount: 10 })
    ).toBe(1.5);
  });

  it('never returns more than one decimal place', () => {
    const r = calculateRating({ violationCount: 7, avgDaysOpen: 130, rentImpairingCount: 2 });
    expect(r).toBe(Math.round(r * 10) / 10);
  });
});
