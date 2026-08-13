[SPEC]
- **Objective**: Rewrite the data-write path (`loadIntoDb.ts`) and data-read path (`queries.ts`) to use the Supabase `pg.Pool` from `web/lib/pgClient.ts` (Phase 1, `specs/003-postgres-schema-driver.md`) instead of `better-sqlite3`, using plain parameterized `pool.query(text, params)` calls (no prepared-statement handles — required by Supabase's transaction-mode pooler, per Phase 1's documented constraint). As the last step of this spec, once Postgres is proven correct via the regression oracle below, remove `better-sqlite3` and `web/lib/db.ts` from the codebase — per the locked 2026-08-12 decision, SQLite is kept only through Phases 1-2 as a regression baseline, not carried further.
- **Inputs/Outputs**:
  - Input: same `RawViolationRow[]` shape from `web/lib/csvLoader.ts` (unchanged by this spec) and the same `ScoringResult` shape from `web/lib/scoring.ts` (unchanged by this spec — Phase 3/4 handle scoring changes separately).
  - Output: `web/lib/loadIntoDb.ts` rewritten to `async function loadIntoDb(pool: Pool, rows: RawViolationRow[], asOf?: Date): Promise<{ buildingsLoaded: number; violationsLoaded: number }>` — same signature shape as today but async and `pg`-backed; upserts via Postgres `ON CONFLICT ... DO UPDATE` (direct SQL translation of the existing SQLite `ON CONFLICT` clauses already in the file).
  - Output: `web/lib/queries.ts` rewritten so `getZipSummaryAndTopBuildings`, `getViolationsForBuilding`, `getHeatmapPoints` become `async` and accept `Pool` instead of `Database.Database`, returning identical response shapes (`BuildingRow`, `ZipSummary`, `ViolationRow`, `HeatmapPoint` interfaces unchanged) — this is a call-site/engine swap, not an API contract change, so the three existing route handlers (`web/app/api/{buildings,violations,heatmap}/route.ts`) only need `await` added, not reshaping (those routes are out of this spec's 5-file cap; a trivial follow-up touch is expected but not included here — flagged below).
  - Output: `web/scripts/load-csv.ts` updated to call the new async `loadIntoDb` against `getPool()` instead of `getDb()`.
- **Design Pattern**: Direct translation of existing SQL (same table/column names, same `ON CONFLICT` upsert logic) from SQLite dialect to Postgres dialect — deliberately not a redesign, to keep this spec a pure engine-swap per Phase 1's stated intent. Async/await replaces `better-sqlite3`'s synchronous API throughout the call chain.
- **Bounded-AI boundary**: 100% deterministic. The loader's aggregation logic (`csvLoader.ts`, untouched) and scoring calculation (`scoring.ts`, untouched) remain plain code; this spec only changes *how* rows move to/from the database, never *what* is computed. No LLM involvement.
- **Verification Oracle**: A regression test — `web/lib/loadIntoDb.test.ts` and `web/lib/queries.test.ts` (both rewritten to run against the real Supabase Postgres instance via `getPool()`) load the same known CSV fixture data and assert the exact same counts previously verified against SQLite: 818 buildings / 10,283 violations for zip 11106 (per `.claude/wiki/project-nyc-open-data-project/context/codebase-map.md`'s verified counts). This is a direct before/after diff — run the loader against SQLite (still present at spec start) and against Postgres (new code) with identical input and assert identical `buildingsLoaded`/`violationsLoaded` counts and identical top-10 `building_id` ordering for zip 11106, before removing SQLite. `npm test -- --run` GREEN on the full rewritten suite is the final oracle after SQLite removal.
- **Intellectual Control**: The regression-diff oracle (SQLite output vs. Postgres output, byte-for-byte count match) is what makes it safe to delete `better-sqlite3` at the end of this spec — the removal isn't taken on faith, it's taken after direct proof the replacement produces identical results on real data. This is the same discipline this project already applies to the scoring formula (spec 001's spot-check-against-manual-calculation oracle).
- **Constraints**:
  - Must use plain parameterized queries per call (`pool.query('SELECT ... WHERE postcode = $1', [zip])`), never a persistent prepared-statement/`PREPARE` pattern — required by Supabase's transaction-mode pooler (Phase 1's documented constraint).
  - Transactions: the existing SQLite code wraps the building+violation upsert in `db.transaction(() => {...})`. Postgres equivalent must use `pool.connect()` → `client.query('BEGIN')` → ... → `COMMIT`/`ROLLBACK` → `client.release()`, not `pool.query('BEGIN')` directly (a pooled connection must be held for the duration of a multi-statement transaction, or statements could land on different pooled connections).
  - `better-sqlite3` removal (last step): delete the `better-sqlite3` and `@types/better-sqlite3` entries from `web/package.json`, delete `web/lib/db.ts`, delete any SQLite-specific test setup — only after the regression oracle above has passed and been confirmed.
- **Edge Cases**: Same edge cases as spec 001 (zip with zero buildings → empty result, not an error; building with zero violations → default score) — unchanged, since this spec doesn't touch scoring or aggregation logic, only the storage engine. New edge case from this rewrite: a Postgres connection failure mid-load (e.g., transient network blip to Supabase) must roll back the transaction, not leave partial data — test this explicitly since SQLite's local-file writes never had this failure mode.
- **Files**: `web/lib/loadIntoDb.ts`, `web/lib/queries.ts`, `web/scripts/load-csv.ts`, `web/lib/loadIntoDb.test.ts`, `web/lib/queries.test.ts` (5 files — at cap; deletion of `web/lib/db.ts` and the `better-sqlite3` package.json entries happens as part of this spec's final step but doesn't count against the touch-cap since it's a removal, not new logic — flag to `optimus-prime` if this reading is disputed).

[FORCES]
1. **Regression-proof correctness > migration speed** — the whole point of keeping `better-sqlite3` through this spec is to have a same-input, same-output diff available; skipping that diff to "just delete SQLite and trust the rewrite" would remove the one safety net this migration has, given there's no staging Postgres environment (Supabase free tier is the only environment, per locked decision #2).
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by keeping the exact same function names/signatures/interfaces (`BuildingRow`, `ZipSummary`, etc.) across the engine swap rather than opportunistically renaming things "while we're in there," which would make this spec harder to review as a pure swap and would blur it with Phase 3/4's scoring changes.
4. **API-route files excluded from this spec's cap, flagged not silently dropped** — `web/app/api/{buildings,violations,heatmap}/route.ts` need a trivial `await` added once `queries.ts` becomes async, but including them here would exceed the 5-file/GRANULARITY cap on a spec already at its limit with core loader/query files. This spec explicitly does not touch those three route files; a human or shockwave should confirm whether that's a same-day trivial follow-up commit under this spec's own review or a dedicated micro-spec — noted here rather than silently left for a builder to discover mid-build.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- Parameterized queries only (`$1`, `$2` placeholders) — never string interpolation into SQL, in both the rewritten `loadIntoDb.ts` and `queries.ts`.
- No `any` types in the rewritten async functions — `Pool`, `PoolClient`, `QueryResult<T>` types used explicitly, matching the existing `BuildingRowRaw`/`BuildingRow`/`ViolationRow`/`HeatmapPoint` interfaces (unchanged).
- Not applicable this spec: Server Components, HttpOnly cookies, Tailwind (no UI touched here — this is data-layer only).

### Build Constraints
- `npm run build` must PASS after the rewrite and after `better-sqlite3` removal.
- No bundle-size regression — `pg` remains server-only (never imported into a client component), `better-sqlite3` removal only shrinks the server bundle.

### Test Constraints
- `web/lib/loadIntoDb.test.ts` and `web/lib/queries.test.ts` rewritten to run against the real Supabase instance (not a mock) — matches spec 001's existing precedent of testing against real loaded data, not mocks, for this exact reason (scoring/count correctness must be provable against real data).
- Full suite `npm test -- --run` GREEN both mid-spec (SQLite still present, for the regression diff) and at spec end (SQLite removed, Postgres-only).
- Coverage on touched files: meaningful assertion coverage on the transaction rollback edge case (connection failure mid-load), not just the happy path.

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8.

### Lint Constraints
- `npm run lint` must PASS (0 violations) on all rewritten/touched files.

### Naming Constraints
- Keep existing exported names unchanged (`loadIntoDb`, `getZipSummaryAndTopBuildings`, `getViolationsForBuilding`, `getHeatmapPoints`) — this is a deliberate naming-stability constraint specific to this spec's "pure engine-swap" framing (see [FORCES] #3), an addition on top of the standard naming rules below.
- Standard project naming rules apply: descriptive names, `camelCase` for functions/variables, no single-letter names except loop indices, booleans read as predicates.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types.
- All previously-synchronous function signatures now correctly typed as `Promise<T>`-returning — callers (route handlers, scripts) must `await` them; a missing `await` should surface as a type error, not a silent bug, so the return types must not be loosely typed as `any`/`unknown`.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after `better-sqlite3` removal (removing a dependency can only help this, but must be confirmed, not assumed).
- No secrets in the rewritten files — `DATABASE_URL` access stays confined to `pgClient.ts` (Phase 1); this spec's files only import `getPool()`, never read `process.env` directly.

### Commit Constraints
- Recommended commit sequence (per this project's Test-Before-Commit + one-feature-per-commit discipline):
  1. `[refactor] loadIntoDb: rewrite for pg.Pool with transaction wrapper`
  2. `[refactor] queries: rewrite for pg.Pool, async signatures`
  3. `[refactor] load-csv script: use getPool() instead of getDb()`
  4. `[test] loadIntoDb/queries: rewrite tests against real Supabase instance, add regression-count assertions`
  5. `[refactor] remove better-sqlite3: delete db.ts and SQLite dependency, Postgres regression-verified`
- All tests GREEN before each commit — critically, commit 5 (SQLite removal) must not happen until commits 1-4's regression oracle has actually passed, not just been written.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: regression counts (818 buildings / 10,283 violations for zip 11106) confirmed identical between the last SQLite run and the first Postgres run, documented in the commit 4 message or a test assertion, before commit 5 removes SQLite entirely.
