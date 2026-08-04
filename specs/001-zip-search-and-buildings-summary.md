[SPEC]
- **Objective**: Given a zip code, return the zip-level summary stats and the top-10 worst buildings by open violations. Covers US-1 (search by zip), US-2 (zip summary stats), US-3 (top-10 worst buildings) in `../context/technologies/user-stories/user_stories.md`.
- **Inputs/Outputs**:
  - Input: `GET /api/buildings?zip={zip}` where `zip` matches `/^\d{5}$/`.
  - Output: `{ summary: { totalViolations, totalBuildings, avgRating, worstBuilding }, topBuildings: Building[] }` (10 items max), `Building` shaped per `buildings` table in `../context/technologies/snippets/schemas/schema_firebase.sql`.
  - Data source for this spec: the verified CSV (`../data/Housing_Maintenance_Code_Violations_20260803.csv`), loaded per `../context/technologies/snippets/DATA_LOADER_CORRECTED.md`. Live Socrata fetch (`../context/API_INTEGRATION.md`) is a separate, later spec.
- **Design Pattern**: none — simple case. Aggregation query + in-memory top-N sort, no framework pattern needed at this scale (826 buildings).
- **Bounded-AI boundary**: 100% deterministic. Rating formula (US-5 weights: violation count 0–2, age 0–2, rent-impairing 0–1, score = 5 − sum) and the top-10 sort are both plain code in the loader/API route. No LLM involvement anywhere in this spec.
- **Verification Oracle**: `GET /api/buildings?zip=11106` returns HTTP 200 with `topBuildings.length === 10`, every item's `rating` between 0 and 5, and `summary.totalViolations === 10467` (the verified count from `../context/data-context/CSV_VERIFICATION_REPORT.md`). Assert via an integration test (`bumblebee`, or a `vitest`/`supertest` test if one exists by build time) hitting the real loaded data — not a mock.
- **Intellectual Control**: Aggregation happens once at load time (buildings table pre-aggregated per `../context/data-context/ADDRESS_RANGE_SUMMARY.md`'s multi-entrance logic), so the API route is a cheap read + sort, not a live join over 10k rows per request. Won't degrade as violation count grows within a single zip's scale.
- **Constraints**: Response must return within 2s (US-1 acceptance criteria). No new dependencies beyond what's already in `snippets.md` — flag to shockwave if the sort/aggregation needs one.
- **Edge Cases**: Zip with zero buildings → `topBuildings: []`, `summary.totalViolations: 0`, HTTP 200 (not 404 — an empty result is a valid answer, not an error). Malformed zip → HTTP 400 with a clear message (feeds US-10).
- **Files**: `lib/db/buildings.ts`, `app/api/buildings/route.ts`, `lib/rating.ts`, `scripts/loadData.ts`, `lib/validation.ts` (5 files — at cap; any additional file needs a spec split).

[FORCES]
1. Correctness of the verified CSV counts (10,467 violations / 826 buildings) > speed of shipping this endpoint — the oracle asserts the exact known-good number, not just "some number."
2. Simplicity > Pattern purity.
