import { describe, expect, it } from "vitest";
import { computeMarkerColor, computeMarkerRadius } from "@/lib/mapMarkers";

// Regression baseline: the original inline `colorFor`/radius formulas this
// module's functions were extracted from, so these tests prove
// byte-identical output.
function legacyColorFor(weight: number, max: number): string {
  const ratio = max > 0 ? Math.min(weight / max, 1) : 0;
  const hue = 120 - ratio * 120;
  return `hsl(${hue}, 80%, 45%)`;
}

function legacyRadiusFor(weight: number, maxWeight: number): number {
  return 4 + (weight / (maxWeight || 1)) * 16;
}

describe("computeMarkerColor", () => {
  it("matches the legacy colorFor implementation across a range of weights and maxes", () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [0, 1],
      [1, 1],
      [5, 10],
      [10, 10],
      [100, 100],
      [3, 7],
      [0, 50],
      [50, 50],
      [25, 100],
    ];
    for (const [weight, max] of cases) {
      expect(computeMarkerColor(weight, max)).toBe(legacyColorFor(weight, max));
    }
  });

  it("returns green (hue 120) for weight 0 relative to any positive max", () => {
    expect(computeMarkerColor(0, 10)).toBe("hsl(120, 80%, 45%)");
  });

  it("returns red (hue 0) when weight equals max", () => {
    expect(computeMarkerColor(10, 10)).toBe("hsl(0, 80%, 45%)");
  });

  it("clamps weight above max to red (hue 0), matching Math.min(weight/max, 1)", () => {
    expect(computeMarkerColor(999, 10)).toBe("hsl(0, 80%, 45%)");
  });

  it("treats max === 0 as ratio 0 (green), avoiding division by zero", () => {
    expect(computeMarkerColor(0, 0)).toBe("hsl(120, 80%, 45%)");
    expect(computeMarkerColor(5, 0)).toBe("hsl(120, 80%, 45%)");
  });
});

describe("computeMarkerRadius", () => {
  it("matches the legacy radius formula across a range of weights and maxWeights", () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [0, 1],
      [1, 1],
      [5, 10],
      [10, 10],
      [100, 100],
      [3, 7],
      [0, 50],
      [50, 50],
      [25, 100],
    ];
    for (const [weight, maxWeight] of cases) {
      expect(computeMarkerRadius(weight, maxWeight)).toBeCloseTo(
        legacyRadiusFor(weight, maxWeight),
        10
      );
    }
  });

  it("returns the minimum radius (4) when weight is 0", () => {
    expect(computeMarkerRadius(0, 100)).toBe(4);
  });

  it("returns the maximum radius (20) when weight equals maxWeight", () => {
    expect(computeMarkerRadius(100, 100)).toBe(20);
  });

  it("guards against maxWeight === 0 by treating the divisor as 1, matching legacy (maxWeight || 1)", () => {
    expect(computeMarkerRadius(0, 0)).toBe(4);
    // legacy: 4 + (5 / (0 || 1)) * 16 = 4 + 80 = 84
    expect(computeMarkerRadius(5, 0)).toBe(84);
  });
});
