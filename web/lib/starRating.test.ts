import { describe, expect, it } from "vitest";
import { ratingToStars, starVariants } from "./starRating";

describe("ratingToStars", () => {
  it("maps 0 -> 0 stars and 100 -> 5 stars", () => {
    expect(ratingToStars(0)).toBe(0);
    expect(ratingToStars(100)).toBe(5);
  });

  it("maps the midpoint to 2.5 stars", () => {
    expect(ratingToStars(50)).toBe(2.5);
  });

  it("rounds to the nearest half star", () => {
    expect(ratingToStars(44)).toBe(2);
    expect(ratingToStars(46)).toBe(2.5);
  });

  it("clamps out-of-range input", () => {
    expect(ratingToStars(-20)).toBe(0);
    expect(ratingToStars(150)).toBe(5);
  });
});

describe("starVariants", () => {
  it("returns all empty for 0 stars", () => {
    expect(starVariants(0)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });

  it("returns all full for 5 stars", () => {
    expect(starVariants(5)).toEqual(["full", "full", "full", "full", "full"]);
  });

  it("places a single half star at the fractional boundary", () => {
    expect(starVariants(2.5)).toEqual(["full", "full", "half", "empty", "empty"]);
  });

  it("returns exactly 5 slots for any input", () => {
    expect(starVariants(3)).toHaveLength(5);
  });
});
