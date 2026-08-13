// Presentation-layer formatting. Pure functions only — no JSX/CSS here so
// they stay testable independent of the component tree.

export type RatingTier = "good" | "fair" | "bad";

// Boundaries follow standard 5-star semantics (1-2 stars terrible/poor,
// 3 stars average, 4-5 stars good/excellent), collapsed to 3 color tiers:
// bad below 2.5 stars (rating 50), good from 3.5 stars up (rating 70),
// fair in between.
export function ratingTier(rating: number): RatingTier {
  if (rating >= 70) return "good";
  if (rating >= 50) return "fair";
  return "bad";
}

export function ratingLabel(rating: number): string {
  switch (ratingTier(rating)) {
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "bad":
      return "Bad";
  }
}

// Raw day counts (some violations are years old) read better humanized.
export function humanizeDaysOpen(days: number): string {
  if (days < 1) return "opened today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} open`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"} open`;
  }
  const years = Math.floor(days / 365);
  const months = Math.round((days % 365) / 30);
  if (months === 0) return `${years} year${years === 1 ? "" : "s"} open`;
  return `${years}y ${months}mo open`;
}
