// Known-zip fixture constants for E2E tests. Adapted from
// context/product/open-violation-e2e-testing-setup.md §1.5, pointed at this
// project's actual verified data (Phase 2 regression oracle fixture: zip
// 11106, 818 buildings — see specs/001-zip-search-and-buildings-summary.md).
export const TEST_ZIPS = {
  // Zip code known to be present in the seeded Postgres fixture data
  // (818 buildings, matches Phase 2's regression oracle).
  LOADED: "11106",
  // Malformed zip (not 5 digits) — must be rejected by
  // web/lib/validation.ts's `/^\d{5}$/` rule before it reaches the DB.
  INVALID: "1234",
  // Valid 5-digit format but not a real NYC zip (lib/nycZips.ts) — exercises
  // the "No such zip code" state, not an error or a live-fetch attempt.
  EMPTY: "99999",
} as const;
