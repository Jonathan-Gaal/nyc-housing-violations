// Deterministic building rating (US-5, user_stories.md). Never LLM-generated —
// see the Bounded-AI boundary in ../CLAUDE.md and specs/001-*.md.
//
// Score = 5 - (violationWeight + ageWeight + rentImpairingWeight), clamped [0, 5].
//   violationWeight:     min(violationCount / 50, 1) * 2   (max 2 points)
//   ageWeight:           min(avgDaysOpen / 2000, 1) * 2    (max 2 points)
//   rentImpairingWeight: min(rentImpairingCount / 20, 1) * 1 (max 1 point)

export interface RatingInput {
  violationCount: number;
  avgDaysOpen: number;
  rentImpairingCount: number;
}

export function calculateRating({
  violationCount,
  avgDaysOpen,
  rentImpairingCount,
}: RatingInput): number {
  const violationWeight = Math.min(violationCount / 50, 1) * 2;
  const ageWeight = Math.min(avgDaysOpen / 2000, 1) * 2;
  const rentImpairingWeight = Math.min(rentImpairingCount / 20, 1) * 1;

  const score = 5 - (violationWeight + ageWeight + rentImpairingWeight);
  return Math.round(Math.max(0, Math.min(5, score)) * 10) / 10;
}
