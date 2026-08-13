[SPEC]
- **Objective**: Replace the existing Leaflet + OpenStreetMap heatmap (`web/components/MapView.tsx`) with Mapbox GL, per `context/product/open-violation-system-prompt.md` §8's visualization guidance. This is the map-library half of Clash 3; the Chart.js addition (`context/product/open-violation-system-prompt.md`'s same §8 section) is deliberately a separate spec (`specs/010-chartjs-violation-timeline.md`) since jazz flagged the two as separable concerns bundled only by accident of doc structure.
- **Inputs/Outputs**:
  - Input: `HeatmapPoint[]` from `web/lib/queries.ts`'s `getHeatmapPoints` — **unchanged type**, this spec swaps the rendering library only, not the data shape or the API route (`web/app/api/heatmap/route.ts` needs no change beyond whatever Phase 2/`specs/005-async-query-route-handlers.md` already required).
  - Output: `web/components/MapView.tsx` rewritten to render a Mapbox GL `Map` with circle markers colored/sized by `weight`, functionally equivalent to the current `colorFor`/radius-scaling logic (green-to-red hue by relative weight, radius scaled 4–20px) — same visual behavior, different rendering engine.
  - New env var: `NEXT_PUBLIC_MAPBOX_TOKEN` (client-exposed by Mapbox's own design — this is not a violation of this project's SECRETS rule, which requires env-var-only storage, not client-invisibility; Mapbox's public token model is documented as intentionally public-safe by the vendor).
- **Design Pattern**: Direct swap within the same component boundary — `MapView`'s external props (`{ points: HeatmapPoint[] }`) and its "no points → empty state" behavior are preserved exactly, so `web/app/page.tsx`'s existing `dynamic(() => import("@/components/MapView"), { ssr: false })` call site needs zero changes. Client Component (`"use client"`), matching the existing file — Mapbox GL requires browser APIs (WebGL canvas), consistent with this project's skill's Pattern 1 exception for browser-API-dependent code.
- **Bounded-AI boundary**: 100% deterministic — marker color/size are computed from `weight` via plain arithmetic (already-tested `colorFor`-equivalent logic), never LLM-generated or LLM-classified. No scoring or ranking logic lives in this file; it only renders values computed elsewhere.
- **Verification Oracle**: Browser-visible — `npm run dev`, search a zip with violation data, switch to "Map" view: the page renders a Mapbox GL canvas element (`.mapboxgl-canvas`, not `.leaflet-container`), markers are visible at the correct lat/lng for the loaded buildings, and the empty-state message ("No mapped violations for this zip.") still renders correctly for a zip with `points.length === 0`. A Playwright test asserting this is deferred to Phase 9 (`specs/012-playwright-feature-specs.md`) since Playwright doesn't exist until Phase 8 — this spec's own oracle is the manual browser check plus a Vitest component-level test verifying `colorFor`-equivalent color/radius math is unchanged (pure-function regression, testable without a real Mapbox render).
- **Intellectual Control**: Isolating this to `MapView.tsx` alone (no changes to `queries.ts`, the heatmap route, or `page.tsx`) keeps the swap auditable as "same data in, same visual result out, different library" — the color/radius math is extracted into a pure, independently-tested function precisely so a reviewer can confirm the visual logic didn't silently change alongside the library swap.
- **Constraints**: `leaflet` and `react-leaflet` removed from `web/package.json` only after Mapbox rendering is confirmed working (same "prove new, then remove old" discipline as Phase 2's SQLite removal, applied here at spec scope rather than project scope since the risk is much lower — a map library swap has no data-correctness stakes, only visual ones). Mapbox GL JS must be dynamically imported / code-split per `context/product/open-violation-system-prompt.md` §9 ("dynamic imports for heavy libraries") — the existing `dynamic(..., { ssr: false })` wrapper in `page.tsx` already provides this, no additional change needed there.
- **Edge Cases**: Zero points → unchanged empty-state message (regression-tested against the existing behavior). Missing/invalid `NEXT_PUBLIC_MAPBOX_TOKEN` at runtime → Mapbox GL's own error surfaces in the browser console; this spec doesn't need to add custom handling beyond what Mapbox's SDK already does, but the empty-state and error paths must not be conflated (a missing token is a config error, not "no violations").
- **Files**: `web/components/MapView.tsx` (rewritten), `web/package.json` (add `mapbox-gl`, `@types/mapbox-gl`; remove `leaflet`, `react-leaflet`), `.env.example` (add `NEXT_PUBLIC_MAPBOX_TOKEN`), new `web/components/MapView.test.ts` (pure color/radius math regression test, since the full component can't easily be unit-tested without a browser WebGL context). 4 files, under cap.

[FORCES]
1. **Visual-logic preservation > library-idiomatic rewrite** — the existing green-to-red hue and radius-scaling logic is a deliberate product decision (a working, already-shipped heatmap), so this spec extracts and preserves that math rather than starting over with "whatever Mapbox's examples do," even though Mapbox's own heatmap layer type could technically replace the manual marker-sizing approach.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by keeping `MapView`'s prop contract (`{ points: HeatmapPoint[] }`) and Client-Component boundary identical to today, rather than opportunistically restructuring the map/page split while the file is already being touched.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- `MapView.tsx` remains a Client Component (`"use client"`) — required for Mapbox GL's browser-only WebGL rendering, an explicit, justified exception to "server components by default" (Pattern 1's own documented "When to break" list includes browser APIs).
- No `any` types — Mapbox GL's TypeScript types (`@types/mapbox-gl`) used explicitly for `Map`, `Marker`, etc.
- No inline secrets — `NEXT_PUBLIC_MAPBOX_TOKEN` from env var, `.env.example` documents it with a placeholder and a comment noting it is intentionally client-exposed (Mapbox's own public-token model), so a future security review doesn't flag it as a leak.
- Tailwind for styling — the existing legend/empty-state markup's Tailwind classes are preserved as-is, only the map-rendering internals change.

### Build Constraints
- `npm run build` must PASS after the dependency swap.
- Bundle-size check: Mapbox GL JS is a heavier dependency than Leaflet — confirm the dynamic-import code-splitting (already present via `page.tsx`'s `dynamic(...)` wrapper) keeps it out of the main bundle; document the resulting chunk size in the PR if it materially changes the app's Lighthouse/LCP numbers (informational, not a hard gate, since this project has no committed Lighthouse baseline yet).

### Test Constraints
- New `web/components/MapView.test.ts`: unit tests for the extracted color/radius pure functions, asserting identical output to the current `colorFor` implementation for the same inputs (regression, not new behavior).
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8 (`specs/011-playwright-setup.md`). A Playwright assertion for the Mapbox canvas element is a natural Phase 9 addition, not required here.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- Keep `MapView` component name unchanged (external contract stability, per [FORCES] #3).
- Extracted pure functions named for what they compute (e.g., `computeMarkerColor`, `computeMarkerRadius`), not `colorFor`/`help1` — slight naming improvement over the current `colorFor` is acceptable since this spec already touches the file, but the *behavior* must stay identical per the regression test.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — Mapbox GL types used throughout.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after the `leaflet`/`react-leaflet` → `mapbox-gl` swap.
- `NEXT_PUBLIC_MAPBOX_TOKEN` documented in `.env.example` as intentionally public per Mapbox's model — not flagged as a leak by `red-alert`/`ratchet` (explicit note in this spec's Constraints to prevent a false-positive security finding).

### Commit Constraints
- Recommended commit sequence:
  1. `[refactor] MapView: extract color/radius math into pure, tested functions (pre-swap regression baseline)`
  2. `[refactor] MapView: swap Leaflet for Mapbox GL, remove leaflet/react-leaflet dependency`
  3. `[chore] env: add NEXT_PUBLIC_MAPBOX_TOKEN to .env.example`
- All tests GREEN before each commit; commit 1 establishes the regression baseline before commit 2 changes the rendering engine, so a broken swap is immediately attributable.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: manual browser check confirms Mapbox canvas renders with correct markers and preserved empty-state behavior; color/radius regression tests green.
