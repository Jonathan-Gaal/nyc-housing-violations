[SPEC]
- **Objective**: Replace the `better-sqlite3` local-file database layer with a Supabase-hosted Postgres schema and a pooled `pg` driver connection, so the app's data layer works on Vercel's ephemeral/read-only serverless filesystem (which cannot host a local SQLite file). This spec creates the schema and connection module only — it does NOT rewrite `loadIntoDb.ts`/`queries.ts` (that's Phase 2, `specs/004-postgres-loader-queries.md`) and does NOT remove `better-sqlite3` (removed at the end of Phase 2, per the locked 2026-08-12 decision — kept here as the regression-check baseline).
- **Inputs/Outputs**:
  - Input: a Supabase project's **pooled connection string** (PgBouncer "Transaction mode" pooler, port 6543 — NOT the direct connection on port 5432), supplied via `DATABASE_URL` env var, never committed.
  - Output: `web/lib/pgClient.ts` exporting a `pg.Pool`-backed `getPool(): Pool` function, mirroring the existing `getDb(): Database.Database` shape in `web/lib/db.ts` so call sites can be swapped one-for-one in Phase 2.
  - Output: `web/db/migrations/001_init.sql` — a single plain numbered SQL file creating `buildings` and `violations` tables, column-for-column equivalent to the existing SQLite schema in `web/lib/db.ts` (see that file's `initSchema()`), adapted to Postgres types (`TEXT`, `INTEGER`, `REAL`→`DOUBLE PRECISION`, etc.) and indexes.
  - Output: `web/scripts/migrate.ts` — a small script that reads `.sql` files from `web/db/migrations/` in filename order and runs each once against `DATABASE_URL`, tracking applied migrations in a `schema_migrations` table it creates on first run. No third-party migration library (per locked decision #4 — plain numbered `.sql` files only).
  - Output: `web/package.json`'s `scripts` block gains `"type-check": "tsc --noEmit"` — this spec and Phase 2 (`specs/004-postgres-loader-queries.md`) both reference `npm run type-check` in their Test/Pre-Push Constraints, and the script does not exist in the current `scripts` block (confirmed by reading `web/package.json`: only `dev`, `build`, `start`, `lint`, `test`, `test:watch`, `load-data` exist today) — added here since this spec already touches `package.json` for the `pg`/`@types/pg` dependency addition, so no new file is added to this spec's Files list.
- **Design Pattern**: Connection pool singleton, same shape as the existing `getDb()` singleton in `web/lib/db.ts` — minimizes churn at call sites in Phase 2 and keeps the pattern-purity/teachability goal (project override) intact by mirroring a pattern the codebase already uses rather than introducing a new one.
- **Bounded-AI boundary**: 100% deterministic. Schema DDL and connection config are fixed, hand-written SQL/TypeScript — no LLM-generated schema inference, no LLM-authored migration content beyond what a human/builder writes directly from the existing SQLite schema as a translation reference.
- **Verification Oracle**: `npx tsx web/scripts/migrate.ts` run against a real (free-tier) Supabase project's `DATABASE_URL` completes without error, and a follow-up `psql "$DATABASE_URL" -c '\dt'` (or equivalent `pg` query in a throwaway script) lists `buildings`, `violations`, and `schema_migrations` tables with the expected columns. Running `npx tsx web/scripts/migrate.ts` a second time is a no-op (idempotent — no duplicate-table errors, `schema_migrations` prevents re-application). Additionally: `npm run type-check` exits 0 against the current codebase once the script is added (proves the script itself is correctly wired, independent of this spec's other changes).
- **Intellectual Control**: Schema is a direct, auditable translation of the already-tested SQLite schema (`web/lib/db.ts` lines 16-58) — same table/column/index shape, so Phase 2's data-path rewrite has a stable, unsurprising target. Using Supabase's documented pooled-connection string (not a hand-rolled pool config) avoids the most common serverless-Postgres failure mode (connection exhaustion from many short-lived Vercel function invocations) without introducing custom pooling logic that would need its own testing.
- **Constraints**:
  - No local Postgres, no `docker-compose.yml` — develop directly against one real Supabase project per the locked 2026-08-12 decision. This simplifies the spec (one environment, not two to keep in sync) but means this spec's oracle requires network access to Supabase, not a fully offline test — call this out to `ratchet`/`wheeljack` explicitly so a "no network in CI" assumption doesn't silently break this spec's verification.
  - Must use the **pooled** connection string (port 6543, PgBouncer "Transaction mode"), not the direct connection (port 5432). This has a real technical consequence for Phase 2: transaction-mode pooling does not support session-level features or persistent server-side prepared statements — Phase 2's query rewrite must issue plain parameterized queries per call (`pool.query(text, params)`), never a `PREPARE`/named-statement pattern. Documented here so Phase 2 doesn't have to rediscover it.
  - `better-sqlite3` and `web/lib/db.ts` are NOT removed or modified by this spec — both database layers coexist through Phase 1 and Phase 2, removed only at the end of Phase 2.
  - No migration library dependency (`pg-migrate`, `knex`, etc.) — plain `.sql` files + one small runner script, per locked decision #4.
- **Edge Cases**: `DATABASE_URL` missing or malformed at script start → `migrate.ts` throws a clear error before attempting any connection (fail fast, matching this project's SECRETS rule — env var only, and a missing one should be loud, not silently retry). Migration file already applied → skipped, logged, exit 0. Two migration files with the same numeric prefix → script throws before running either (ambiguous order is an error, not a guess).
- **Files**: `web/lib/pgClient.ts` (new), `web/db/migrations/001_init.sql` (new), `web/scripts/migrate.ts` (new), `web/package.json` (add `pg`, `@types/pg` to dependencies, flagged for shockwave authorization and granted in this spec; add `"type-check": "tsc --noEmit"` to `scripts`), `.env.example` (add `DATABASE_URL` entry with a placeholder pooled-connection-string shape and a comment noting port 6543 / Transaction mode). 5 files, at cap.

[FORCES]
1. **Serverless-correctness > local-dev convenience** — the entire reason this migration exists is that SQLite's local file does not survive Vercel's ephemeral filesystem; every design choice here (pooled connection, no local Postgres) optimizes for what actually runs in production, even where a local Postgres would have been marginally simpler to set up for `wheeljack`.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied here by deliberately mirroring `web/lib/db.ts`'s existing singleton-getter pattern in the new `pgClient.ts` rather than inventing a different connection-management style, even though a simpler one-off `new Pool()` call at each use site would technically work.
4. **Schema fidelity > schema improvement** — this spec translates the existing SQLite schema as-is (same columns, same names) rather than adopting product-spec §5.1's slightly different Postgres schema (different column names like `bin` as primary key vs. this project's `building_id`). Reconciling toward product-spec's schema, if desired, is a separate future decision — not silently folded into this migration spec, to keep Phase 2's rewrite a pure engine-swap rather than a simultaneous schema redesign.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- Parameterized queries only — `pgClient.ts` and `migrate.ts` never string-concatenate SQL; migration file content is static, not templated from any external input.
- No inline secrets — `DATABASE_URL` from env var only, `.env.example` documents the shape with a placeholder, never a real value.
- No `any` types in `pgClient.ts`/`migrate.ts` — `Pool`, `PoolClient` types from `@types/pg` used explicitly.
- Not applicable this spec: Server Components / HttpOnly cookies (no UI or auth code touched here).

### Build Constraints
- `npm run build` must PASS after adding `pg`/`@types/pg` and the new files (build should succeed even without a live `DATABASE_URL` at build time — connection is lazy, first made on first `getPool()` call, matching the existing `getDb()` lazy-init pattern).
- No bundle-size constraint applies meaningfully here (`pg` is a server-only dependency, never bundled client-side) — but confirm `pg` is not accidentally imported from a client component.

### Test Constraints
- New unit test `web/lib/pgClient.test.ts`: verifies `getPool()` returns a singleton (same instance on repeated calls, mirroring the existing pattern's test coverage style for `getDb()` if one exists, or written fresh if not).
- `npm test -- --run` must remain GREEN for the full existing 37-test suite (Phase 1 adds a new test file but must not break any existing one — `db.ts`/`loadIntoDb.ts`/`queries.ts` are untouched by this spec).
- No coverage regression on touched files (`pgClient.ts`, `migrate.ts`) — aim for meaningful coverage of the singleton behavior and the migration-runner's idempotency logic, not a raw percentage target given the small file scope.

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8. This spec's oracle (above) is the migration script run manually/in a setup step, not a browser-visible E2E check.

### Lint Constraints
- `npm run lint` must PASS (0 violations) on all new files.

### Naming Constraints
- `getPool()` (not `getDb2()` or `pool()`) — descriptive, distinguishes from the existing `getDb()` without implying it replaces it yet.
- `runMigrations()` as the exported function name in `migrate.ts`, not `run()` or `main()`.
- Migration file: `001_init.sql` (zero-padded numeric prefix + underscore + descriptive slug, matching the `YYYYMMDD_HHmmss_description.sql`-style convention referenced in `native_ai/.claude/INDUSTRY-BEST-PRACTICES.md` §7, simplified to a sequential integer prefix since this is the first migration and sub-second ordering isn't needed yet — revisit the timestamp-prefix convention starting with the second migration file if one is added in a later spec).

### Type Constraints
- `npm run type-check` (`tsc --noEmit`) must PASS (0 errors) — this spec adds the `type-check` script to `web/package.json` (see Inputs/Outputs above); it must be added and proven working (exit 0) as part of this spec, not assumed to already exist.
- No `any` types — `Pool`/`QueryResult` types from `@types/pg` used throughout.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after adding `pg`/`@types/pg`.
- `DATABASE_URL` never logged in full — if `migrate.ts` logs connection status, it must redact the credential portion of the connection string (e.g., log "connecting to Supabase (redacted)" not the raw URL), per `native_ai/.claude/INDUSTRY-BEST-PRACTICES.md` §4's "never log secrets" line.
- `.env.example`'s `DATABASE_URL` entry is a placeholder shape only (e.g., `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`), never a real credential.

### Commit Constraints
- Commit message format: `[refactor] pgClient: add Supabase pooled connection + init migration`.
- Each logical unit its own commit if the builder finds a natural split (e.g., one commit for `pgClient.ts` + `.env.example`, one for the migration SQL + runner script, one for the `type-check` script addition) — otherwise one atomic commit is acceptable given the 5-file cap.
- All tests GREEN before commit (Test Before Commit rule, per `../../../../.claude/BUILD-PROCESS.md`).

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: `npx tsx web/scripts/migrate.ts` succeeds against the real Supabase `DATABASE_URL` and is confirmed idempotent on a second run; `npm run type-check` exits 0.
