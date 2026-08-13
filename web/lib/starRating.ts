export type StarVariant = "full" | "half" | "empty";

// Converts the app's 0-100 composite building score into a familiar 0-5
// star scale, rounded to the nearest half star — matches how Yelp/Google
// display ratings (discrete full/half stars, not an arbitrary fill
// percentage), which is what "accurate stars" means here. Floored at 1
// star: an empty 0-star row reads as "no rating" rather than "worst
// rating," so even the single worst building displays at least 1 star.
export function ratingToStars(rating: number): number {
  const clamped = Math.max(0, Math.min(100, rating));
  const stars = Math.round(((clamped / 100) * 5) * 2) / 2;
  return Math.max(1, stars);
}

// One variant per star slot (5 total), left to right.
export function starVariants(stars: number): StarVariant[] {
  return [1, 2, 3, 4, 5].map((slot) => {
    if (stars >= slot) return "full";
    if (stars >= slot - 0.5) return "half";
    return "empty";
  });
}
