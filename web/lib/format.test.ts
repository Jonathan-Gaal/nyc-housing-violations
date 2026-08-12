import { describe, expect, it } from "vitest";
import { ratingTier, ratingLabel, humanizeDaysOpen } from "./format";

describe("ratingTier / ratingLabel", () => {
  // Thresholds rescaled to 0-100 (specs/006-scoring-rescale-0-100.md):
  // >=80 excellent, >=60 good, >=30 fair, else poor.
  it("buckets ratings into the four tiers", () => {
    expect(ratingTier(100)).toBe("excellent");
    expect(ratingTier(80)).toBe("excellent");
    expect(ratingTier(79)).toBe("good");
    expect(ratingTier(60)).toBe("good");
    expect(ratingTier(59)).toBe("fair");
    expect(ratingTier(30)).toBe("fair");
    expect(ratingTier(29)).toBe("poor");
    expect(ratingTier(0)).toBe("poor");
  });

  it("labels match the tier", () => {
    expect(ratingLabel(100)).toBe("Excellent");
    expect(ratingLabel(60)).toBe("Good");
    expect(ratingLabel(40)).toBe("Fair");
    expect(ratingLabel(4)).toBe("Poor");
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
