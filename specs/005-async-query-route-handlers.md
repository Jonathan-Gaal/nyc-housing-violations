[SPEC]
- **Objective**: Add `await` to the three API route handlers' calls into `web/lib/queries.ts`, which `specs/004-postgres-loader-queries.md` made `async` (Postgres-backed) but explicitly and deliberately excluded from its own 5-file cap (see that spec's [FORCES] #4). This is a **required companion to Phase 2, not an optional follow-up** — without this spec, the app does not build/run correctly after Phase 2 lands, because `getZipSummaryAndTopBuildings`, `getViolationsForBuilding`, and `getHeatmapPoints` all return `Promise<T>` as of Phase 2, and these three route handlers currently call them synchronously. This spec must build immediately after Phase 2 and before Phase 3 (`specs/006-scoring-rescale-0-100.md`).
- **Inputs/Outputs**:
  - Input: the three existing route handlers' current synchronous calls into `getDb()`/`getZipSummaryAndTopBuildings`/`getViolationsForBuilding`/`getHeatmapPoints` (confirmed by direct read of all three files at spec-writing time — e.g. `web/app/api/heatmap/route.ts`'s current `const db = getDb(); const points = getHeatmapPoints(db, zip as string);`).
  - Output: all three routes updated to `const pool = getPool(); const result = await getXxx(pool, ...)` — replacing the SQLite `getDb()` import/call with Phase 1's `getPool()` (`web/lib/pgClient.ts`) and awaiting the now-async query functions. Response shape, status codes, and error-handling structure (`{ error: ... }` JSON, existing status codes) are **unchanged** — this is purely an async/engine-swap plumbing fix, not a response-contract change.
- **Design Pattern**: none — simple case, a mechanical `await` + import-source change across three near-identical route handlers.
- **Bounded-AI boundary**: 100% deterministic. No scoring, ranking, or data transformation logic lives in these route handlers — they are thin HTTP adapters over `queries.ts`'s already-deterministic functions (Phase 2). This spec adds no new logic, only correct async plumbing.
- **Verification Oracle**: `npm run build` succeeds (a missing `await` on a function now typed `Promise<T>` would surface as a TypeScript error under this project's strict mode, per the Type Constraints below — build failure is the primary, fast-feedback oracle). Additionally, an integration test per route (`web/app/api/buildings/route.test.ts`, `web/app/api/violations/route.test.ts`, `web/app/api/heatmap/route.test.ts`, if not already covered by existing tests — check first, extend if present) hits each route against the real Postgres instance seeded in Phase 2 and asserts a 200 response with the expected shape for a known zip (11106), proving the `await` actually resolves real data, not just that the code compiles.
- **Intellectual Control**: Isolating this as its own spec — rather than letting `wheeljack` guess whether to fold it into Phase 2 or discover the break later — means the dependency is explicit and sequenced, not accidentally skipped. Because the change is mechanical and the response contract is unchanged, this spec's risk is low, but the *consequence of skipping it* (a broken build immediately after Phase 2) is severe enough to warrant its own named, ordered spec rather than a footnote.
- **Constraints**: No new dependencies. No response-shape changes — any drift in status codes, error JSON structure, or field names versus the current behavior is a bug in this spec, not an intended improvement (that would be a separate, deliberately-scoped spec). Must be built and merged before `specs/006-scoring-rescale-0-100.md` (Phase 3), since Phase 3 assumes a fully working, Postgres-backed read path to regression-test against.
- **Edge Cases**: None new — this spec inherits exactly the existing edge-case behavior of each route (invalid zip → 400, zero-result zip → 200 with empty array, server error → 500) from before Phase 2; the only change is *how* the underlying data is fetched (awaited Postgres call vs. synchronous SQLite call), not what happens on each input class.
- **Files**: `web/app/api/buildings/route.ts`, `web/app/api/violations/route.ts`, `web/app/api/heatmap/route.ts`. 3 files, well under cap; references `web/lib/queries.ts` and `web/lib/pgClient.ts` (2 references, under the 3-reference cap).

[FORCES]
1. **Explicit sequencing > implicit assumption** — `specs/004-postgres-loader-queries.md` correctly stayed under its file cap by excluding these three files, but a builder working strictly spec-by-spec without this companion would ship a broken build; naming this spec and its required immediately-after-004 position removes that gap entirely.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by keeping all three routes' existing error-handling/response-shape structure identical, changing only the data-fetching mechanics, rather than opportunistically "improving" error handling while the files are already open (that would blur this spec's narrow, mechanical scope).

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- API routes remain server-only route handlers — no Client Component involvement.
- No `any` types — the awaited return types from `queries.ts` (`ZipSummary`/`BuildingRow[]`, `ViolationRow[]`, `HeatmapPoint[]`) are already explicitly typed by Phase 2; this spec must not weaken that with an `any` cast to work around a type mismatch.
- Parameterized queries — unaffected, this spec doesn't touch query construction, only the calling convention (await) at the route layer.

### Build Constraints
- `npm run build` must PASS — this is the primary oracle; a missing `await` on a `Promise`-returning function is expected to surface as a build-time type error under this project's strict TypeScript config, making a silent miss unlikely.
- No bundle-size impact — server-only route handlers, never bundled client-side.

### Test Constraints
- Existing/extended route-level tests (see Verification Oracle) must assert 200 responses with correct shape for zip 11106 against real Postgres data.
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8 (`specs/011-playwright-setup.md`, renumbered). Phase 9's feature specs (`specs/012-playwright-feature-specs.md`, renumbered) will exercise these routes indirectly through the UI once Playwright exists.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- No new identifiers introduced beyond what Phase 1 (`getPool`) and Phase 2 (`getZipSummaryAndTopBuildings`, etc.) already named — this spec is pure call-site plumbing, not new naming surface.

### Type Constraints
- `npm run type-check` must PASS (0 errors) — this is the spec's most direct type-safety proof: every awaited call must resolve to the exact typed shape `queries.ts` declares, no `any`, no unchecked casts.
- No `any` types.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) — no dependency changes.
- No secrets involved — this spec touches no env vars or credential-handling code directly (it relies on `getPool()`'s already-established `DATABASE_URL` handling from Phase 1).

### Commit Constraints
- Recommended commit sequence:
  1. `[fix] api/buildings: await async queries.ts calls, use getPool() instead of getDb()`
  2. `[fix] api/violations: await async queries.ts calls, use getPool() instead of getDb()`
  3. `[fix] api/heatmap: await async queries.ts calls, use getPool() instead of getDb()`
- All tests GREEN before each commit; this spec's commits should land immediately after Phase 2's final commit, before any Phase 3 work begins.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: `npm run build` succeeds; route-level integration tests return correct 200 responses against real Postgres data for zip 11106.
