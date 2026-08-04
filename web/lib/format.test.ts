import { describe, expect, it } from "vitest";
import { ratingTier, ratingLabel, humanizeDaysOpen } from "./format";

describe("ratingTier / ratingLabel", () => {
  it("buckets ratings into the four tiers", () => {
    expect(ratingTier(5)).toBe("excellent");
    expect(ratingTier(4)).toBe("excellent");
    expect(ratingTier(3.9)).toBe("good");
    expect(ratingTier(3)).toBe("good");
    expect(ratingTier(2.9)).toBe("fair");
    expect(ratingTier(1.5)).toBe("fair");
    expect(ratingTier(1.4)).toBe("poor");
    expect(ratingTier(0)).toBe("poor");
  });

  it("labels match the tier", () => {
    expect(ratingLabel(5)).toBe("Excellent");
    expect(ratingLabel(3)).toBe("Good");
    expect(ratingLabel(2)).toBe("Fair");
    expect(ratingLabel(0.2)).toBe("Poor");
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
