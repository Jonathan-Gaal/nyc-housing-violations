[SPEC]
- **Objective**: Given a zip code, return the zip-level summary stats and the top-10 worst buildings ranked by landlord *responsiveness*, not violation count. Covers US-1 (search by zip), US-2 (zip summary stats), US-3 (top-10 worst buildings ranked by composite score) in `../context/technologies/user-stories/user_stories.md`.
- **Inputs/Outputs**:
  - Input: `GET /api/buildings?zip={zip}` where `zip` matches `/^\d{5}$/`.
  - Output: `{ summary: { totalViolations, totalBuildings, avgScore, worstBuilding }, topBuildings: Building[] }` (10 items max). `Building` includes `{ address, score, scoringBreakdown, totalViolations, rentImparingCount, avgYearsOpen, percentDeadEnd, percentReissued, recurringIssueCount }`.
  - Data source: the verified CSV (`../data/Housing_Maintenance_Code_Violations_20260803.csv`), loaded per `../context/technologies/snippets/DATA_LOADER_CORRECTED.md`. Live Socrata fetch (`../context/API_INTEGRATION.md`) is a separate, later spec.
- **Scoring Algorithm** (0–5 scale, lower = worse landlord responsiveness):
  - `score = 5 − ((totalViolations × 0.25) + (rentImpairing × 0.25) + (avgYearsOpen × 0.20) + (percentDeadEnd × 0.15) + (percentReissued × 0.15))`
  - Each factor is scaled to 0–1 range before multiplication:
    - `totalViolations`: count scaled to 0–1 on 0–100 violation range (100 violations = 1 point deduction)
    - `rentImpairing`: count scaled to 0–1 on 0–40 rent-impairing range (40+ rent-impairing = 1 point deduction)
    - `avgYearsOpen`: years scaled to 0–1 on 0–8 year range (8+ years = 1 point deduction)
    - `percentDeadEnd`: % of violations in "NOV SENT OUT", "NOT COMPLIED WITH", or "NO ACCESS TO INSPECT" (0–100%, becomes 0–1 point deduction)
    - `percentReissued`: % of violations where same violation type re-opened (0–100%, becomes 0–1 point deduction)
  - `scoringBreakdown`: object returning unscaled component values `{ totalViolations, rentImpairing, avgYearsOpen, percentDeadEnd, percentReissued }` (e.g., `{ totalViolations: 45, avgYearsOpen: 3.2, ... }`) so frontend can show the *why* behind the score.
  - **Future (Phase 2)**: `recurringIssueCount`: count of times the *exact same violation description* has been reissued on this building (included in response now for dashboard exploration, weight TBD, not yet in score calculation).
- **Design Pattern**: Aggregation at load time (buildings table pre-aggregated per `../context/data-context/ADDRESS_RANGE_SUMMARY.md`'s multi-entrance logic), in-memory top-N sort by composite score ascending (worst first). No framework pattern needed at this scale (826 buildings).
- **Bounded-AI boundary**: 100% deterministic. Composite score calculation and top-10 sort are plain code in loader/API route. No LLM involvement.
- **Verification Oracle**: `GET /api/buildings?zip=11106` returns HTTP 200 with `topBuildings.length === 10`, every item's `score` between 0 and 5, `summary.totalViolations === 10467` (verified count from `../context/data-context/CSV_VERIFICATION_REPORT.md`), `topBuildings[0].score <= topBuildings[9].score` (sorted ascending, worst first). Spot-check one building's `scoringBreakdown` against manual calculation to verify all factors are computed correctly. Assert via integration test hitting real loaded data — not a mock.
- **Intellectual Control**: All scoring arithmetic is deterministic and transparent. Frontend can display each breakdown component so renter understands *why* a building scores low. No opaque ML or heuristics — every point deduction is explainable.
- **Constraints**: Response must return within 2s (US-1 acceptance criteria). No new dependencies beyond what's already in `snippets.md` — flag if the scoring math needs one.
- **Edge Cases**: Zip with zero buildings → `topBuildings: []`, `summary.totalViolations: 0`, HTTP 200 (empty result is valid, not an error). Malformed zip → HTTP 400 with structured error `{ code: "INVALID_ZIP", message: "Zip must be 5 digits" }` (not prose). Building with zero violations → `score = 5.0`, all breakdown components = 0. Building with only recent violations (< 6 months) → `avgYearsOpen` approaches 0, score improves.
- **Files**: `lib/db/buildings.ts`, `app/api/buildings/route.ts`, `lib/scoring.ts`, `scripts/loadData.ts`, `lib/validation.ts` (5 files — at cap; rename `lib/rating.ts` → `lib/scoring.ts` to reflect composite algorithm).

[FORCES]
1. **Scoring correctness > speed** — The composite algorithm is the entire product insight. A fast endpoint returning wrong rankings defeats the purpose. Verification oracle must confirm that top-ranked buildings are actually the ones with longest-stuck violations, not just highest counts.
2. **Transparency > elegance** — Every score point must be explainable. Renters need to see the breakdown (`scoringBreakdown`) so they trust the ranking. A "magic" score with no visibility is useless.
3. **Responsiveness signal > violation count** — The sort order must surface *unresponsive landlords*, not busy buildings. A building with 500 violations fixed in 3 months should rank higher than a building with 50 violations stuck for 5 years. The algorithm (not UI) must encode this.
