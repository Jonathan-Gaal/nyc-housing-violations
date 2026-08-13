import { describe, expect, it } from "vitest";
import { ratingTier, ratingLabel, humanizeDaysOpen } from "./format";

describe("ratingTier / ratingLabel", () => {
  // Quartile-based thresholds (rating is a percentile): >=75 good,
  // >=25 fair, else bad.
  it("buckets ratings into the three tiers", () => {
    expect(ratingTier(100)).toBe("good");
    expect(ratingTier(75)).toBe("good");
    expect(ratingTier(74)).toBe("fair");
    expect(ratingTier(25)).toBe("fair");
    expect(ratingTier(24)).toBe("bad");
    expect(ratingTier(10)).toBe("bad");
    expect(ratingTier(0)).toBe("bad");
  });

  it("labels match the tier", () => {
    expect(ratingLabel(100)).toBe("Good");
    expect(ratingLabel(50)).toBe("Fair");
    expect(ratingLabel(10)).toBe("Bad");
  });
});

describe("humanizeDaysOpen", () => {
  it("handles same-day", () => {
    expect(humanizeDaysOpen(0)).toBe("opened today");
  });

  it("shows days under a month", () => {
    expect(humanizeDaysOpen(5)).toBe("5 days open");
    expect(humanizeDaysOpen(1)).toBe("1 day open");
  });

  it("shows months under a year", () => {
    expect(humanizeDaysOpen(60)).toBe("2 months open");
  });

  it("shows years (+ months) over a year", () => {
    expect(humanizeDaysOpen(365)).toBe("1 year open");
    expect(humanizeDaysOpen(952)).toBe("2y 7mo open");
  });
});
