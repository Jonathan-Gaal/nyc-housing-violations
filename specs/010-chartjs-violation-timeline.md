[SPEC]
- **Objective**: Add a violation-timeline chart (open/closed/reissued counts over time) to the building-detail view, using Chart.js per `context/product/open-violation-system-prompt.md` §8's visualization guidance. Separated from the Mapbox swap (`specs/009-mapbox-swap.md`) per jazz's explicit flag that the two are separable concerns bundled only by accident of the source doc's section structure — this spec depends on nothing from Phase 6 and can build independently.
- **Inputs/Outputs**:
  - Input: `ViolationRow[]` from `web/lib/queries.ts`'s existing `getViolationsForBuilding` — **unchanged type**, this spec adds a new consumer of already-available data, not a new query shape (the existing `web/app/api/violations/route.ts` and `BuildingCard.tsx`'s existing fetch-on-expand behavior already retrieve this data; this spec adds a visualization of it, reusing the same fetched data rather than issuing a second request).
  - Output: new `web/components/ViolationTimeline.tsx` — a Client Component rendering a Chart.js bar or line chart of violations grouped by month (using `inspection_date`), colored/segmented by `current_status`/`violation_status` to distinguish open vs. closed vs. reissued, matching product-spec §4.3's response schema intent (`violationTimeline: { opened, closed, reissued, avgDaysOpen }`) at a per-building level.
  - Output: `web/components/BuildingCard.tsx` updated to render `<ViolationTimeline violations={violations} />` inside its existing expanded-detail section (the section that already lists violations by entrance) — additive, not a restructure of that component's existing expand/collapse behavior.
- **Design Pattern**: Presentational component consuming already-fetched data via props — no new data fetching, no new API route. Client Component (`"use client"`), required because Chart.js renders to a `<canvas>` via browser APIs, same justified exception as `MapView.tsx`.
- **Bounded-AI boundary**: 100% deterministic. Grouping violations by month and counting open/closed/reissued per bucket is plain aggregation code, computed client-side from already-server-fetched data — no LLM involvement in counting, bucketing, or labeling.
- **Verification Oracle**: Browser-visible — expand a building card with violation history spanning multiple months, confirm a `<canvas>` chart renders inside the expanded section showing distinguishable open/closed/reissued segments; a building with zero violations (edge case, though such buildings shouldn't normally appear in results per existing empty-state handling) renders no chart or an explicit "no violation history" message, not a broken/empty canvas. A Vitest test (`web/lib/violationTimelineData.test.ts`) asserts the pure month-bucketing/counting function produces correct grouped counts for a known fixture set of `ViolationRow[]` (e.g., 5 violations across 3 months, 2 closed, 1 reissued → asserted bucket counts) — this is the spec's primary automated oracle, since full Chart.js canvas rendering isn't practically unit-testable without a browser.
- **Intellectual Control**: Extracting the month-bucketing/counting logic into a pure, separately-tested function (`buildViolationTimelineData` or similar) means the chart's *correctness* (are these violations counted in the right month/status bucket) is verifiable without needing to test Chart.js's rendering internals — the chart component itself becomes a thin, low-risk wrapper around already-proven data.
- **Constraints**: No new data fetching — this component receives `violations: ViolationRow[]` as a prop from `BuildingCard`'s existing state (`violations` state variable, already populated by the existing `/api/violations` fetch-on-expand call), it does not issue its own fetch. Chart.js and its React binding (`react-chartjs-2` or equivalent) must be dynamically imported for code-splitting, matching the same "heavy library, defer loading" principle applied to Mapbox GL in Phase 6.
- **Edge Cases**: Building with only one violation → chart renders a single-bucket view, not an error. Building with violations spanning many years → month-bucketing must not produce an unreadably dense x-axis; a reasonable default (e.g., collapse to year-buckets if the date range exceeds ~24 months) should be considered, or explicitly deferred with a comment if out of scope for this pass — flagged here so a builder makes a deliberate choice rather than shipping an unreadable chart by accident. Missing/null `inspection_date` on a violation row → excluded from bucketing (logged, not silently miscounted into a wrong bucket).
- **Files**: `web/components/ViolationTimeline.tsx` (new), `web/lib/violationTimelineData.ts` (new, pure bucketing/counting function), `web/lib/violationTimelineData.test.ts` (new), `web/components/BuildingCard.tsx` (add the new component to the existing expanded section), `web/package.json` (add `chart.js`, `react-chartjs-2`). 5 files, at cap.

[FORCES]
1. **Reuse of already-fetched data > a new dedicated endpoint** — `BuildingCard.tsx` already fetches `ViolationRow[]` on expand; adding a second network request just for the chart would duplicate data and add latency for no benefit, so this spec deliberately threads the existing fetched data into the new component as a prop.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by extracting the bucketing logic into its own pure, independently-tested module (`violationTimelineData.ts`) rather than inlining it into the component, even though inlining would be marginally less code for a first pass; this keeps the "deterministic computation, separately verifiable from rendering" pattern consistent with how `scoring.ts` and `format.ts` are already structured in this codebase.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- `ViolationTimeline.tsx` is a Client Component (`"use client"`) — justified browser-API exception (canvas rendering), same reasoning as `MapView.tsx`.
- No `any` types — Chart.js's TypeScript types used explicitly for chart config/data structures.
- No inline secrets — not applicable, this spec has no secret-bearing config.
- Tailwind for any layout/spacing around the chart container; Chart.js's own styling API handles the chart's internal visual config (colors, axes) since that's outside Tailwind's scope by nature.

### Build Constraints
- `npm run build` must PASS.
- Dynamic import for Chart.js/`react-chartjs-2` to keep it out of the main bundle, consistent with Phase 6's Mapbox handling.

### Test Constraints
- `web/lib/violationTimelineData.test.ts`: full coverage of the bucketing/counting pure function, including the edge cases listed above (single violation, missing `inspection_date`, wide date range).
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8 (`specs/011-playwright-setup.md`). A Playwright assertion that the chart canvas renders on building-detail expand is a natural Phase 9 addition, not required here.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- `buildViolationTimelineData` (not `getData` or `chartData`) — states what it computes.
- `ViolationTimeline` component name matches its purpose directly (no abbreviation).

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — Chart.js config objects explicitly typed via the library's own exported types.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after adding `chart.js`/`react-chartjs-2`.
- No secrets involved — pure client-side rendering of already-authorized data (violations are public data per this project's existing "no auth required" MVP state; Phase 12's auth work, once built, doesn't retroactively require this spec to change since violation data remains public per product-spec §6.1's "no auth required" public endpoints).

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] violationTimelineData: add pure month-bucketing/counting function with tests`
  2. `[feat] ViolationTimeline: add Chart.js component consuming bucketed data`
  3. `[feat] BuildingCard: render ViolationTimeline in expanded section`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: bucketing/counting unit tests green; manual browser check confirms chart renders correctly on a real building with multi-month violation history.
