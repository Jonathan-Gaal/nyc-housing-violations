// Presentation-layer formatting. Pure functions only — no JSX/CSS here so
// they stay testable independent of the component tree.

export type RatingTier = "excellent" | "good" | "fair" | "poor";

// Thresholds calibrated to the 0-100 score scale (specs/006-scoring-rescale-0-100.md,
// 2026-08-12) — a x20 rescale of the prior 0-5 thresholds (>=4, >=3, >=1.5).
export function ratingTier(rating: number): RatingTier {
  if (rating >= 80) return "excellent";
  if (rating >= 60) return "good";
  if (rating >= 30) return "fair";
  return "poor";
}

export function ratingLabel(rating: number): string {
  switch (ratingTier(rating)) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "poor":
      return "Poor";
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
