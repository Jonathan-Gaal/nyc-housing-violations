// Presentation-layer formatting. Pure functions only — no JSX/CSS here so
// they stay testable independent of the component tree.

export type RatingTier = "good" | "fair" | "bad";

// `rating` is a citywide percentile (lib/scoring.ts's
// recomputeCityWidePercentiles), not a raw score — uniformly spread 0-100
// by construction, unlike the old skewed weighted-average scale these
// thresholds used to be calibrated for. Quartile-based tiers are the
// natural fit for a percentile scale: bottom quarter is bad, top quarter
// is good, the broad middle half reads as fair (matches "3 stars/average"
// covering most of a typical 5-star distribution).
export function ratingTier(rating: number): RatingTier {
  if (rating >= 75) return "good";
  if (rating >= 25) return "fair";
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
