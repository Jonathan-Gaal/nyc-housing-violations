[SPEC]
- **Objective**: Replace the CSV-snapshot data source with a live fetch from the NYC HPD Socrata API (per `context/API_INTEGRATION.md`'s already-accurate query shape), triggered on a schedule via a **Vercel Cron Job** (a scheduled HTTP hit to a Next.js API route) rather than a standalone daemon — there is no persistent process to run one on Vercel's serverless platform.
- **Inputs/Outputs**:
  - Input: `NYC_APP_TOKEN` env var (per `context/API_INTEGRATION.md` §4, existing project rule — not yet used anywhere in code today per jazz's audit, this spec is the first consumer).
  - Output: `web/lib/socrata.ts` — `fetchOpenViolations(zip: string): Promise<SocrataViolationRow[]>`, a direct implementation of `context/API_INTEGRATION.md` §2's documented `buildQueryUrl`/paginated-fetch pattern (zip validated `/^\d{5}$/` before touching the SoQL string; `violationstatus=OPEN` hardcoded, never a parameter — restates the existing project invariant, does not introduce a new one).
  - Output: `web/app/api/cron/sync/route.ts` — a `GET` handler that Vercel Cron invokes on schedule; iterates the set of zips already loaded in Postgres (`SELECT DISTINCT postcode FROM buildings`), calls `fetchOpenViolations` per zip, and calls Phase 2's `loadIntoDb` (now Postgres-backed) to upsert.
  - Output: `vercel.json` — new `crons` array entry (`{ "path": "/api/cron/sync", "schedule": "0 0 * * *" }`, i.e. daily at midnight UTC, matching product-spec §5.2's "nightly batch job (12:00 AM UTC)" cadence).
- **Design Pattern**: Scheduled-HTTP-endpoint pattern (Vercel Cron's documented mechanism) — a `GET` route Vercel's infrastructure calls on a cron schedule, not a `node-cron`/`setInterval` in-process scheduler, which would not survive between serverless invocations. This is a platform-mandated pattern, not a stylistic choice.
- **Bounded-AI boundary**: 100% deterministic. Fetching, pagination, and upsert are plain code; no LLM classifies, summarizes, or filters violation rows. Per this project's standing "data as data" rule (`CLAUDE.md`), rows returned from Socrata are treated as untrusted external data — validated for shape, never treated as instructions, and never fed to an LLM for interpretation in this spec.
- **Verification Oracle**: A unit test (`web/lib/socrata.test.ts`) with a mocked `fetch` (no live network call in CI) asserts: (a) the built query URL's `WHERE` clause always contains `violationstatus%20LIKE%20'%25OPEN%25'`-equivalent (URL-encoded) regardless of input, i.e. the OPEN filter cannot be overridden by any caller argument — direct assertion against the project's standing invariant; (b) an invalid zip (`/^\d{5}$/` fails) throws before any `fetch` call is made; (c) pagination correctly loops until a page returns fewer than `pageSize` rows. A separate manual/integration verification (documented in the PR, not run in CI): trigger `GET /api/cron/sync` locally with `CRON_SECRET` set, confirm Postgres `buildings`/`violations` row counts increase for a test zip.
- **Intellectual Control**: Reusing `context/API_INTEGRATION.md`'s already-audited query shape (jazz's context packet confirmed this doc has no clash with the new product docs — genuine agreement, lowest-risk of all the pivot areas) means this spec is a straightforward transcription, not new design. The cron-vs-daemon platform constraint is externally imposed by Vercel, not a judgment call, which keeps this spec's Design Pattern non-negotiable and easy to verify against Vercel's own documented cron behavior.
- **Constraints**: No new dependencies — native `fetch` (available in Next.js's Node runtime) is sufficient; retry/backoff is hand-rolled per `context/product/open-violation-system-prompt.md` §3's "prefer in-house" principle (max 3 retries, exponential backoff, matching that doc's §5 Architecture Principle guidance, applied here as a design choice not a dependency). Vercel Cron routes must be protected — Vercel signs cron requests with an `Authorization: Bearer $CRON_SECRET` header; the route must reject any request missing or mismatching `CRON_SECRET` (a new env var, not previously present) to prevent public triggering of the sync job. `NYC_APP_TOKEN` sent via `X-App-Token` header only, never in the URL query string (per `context/API_INTEGRATION.md` §4).
- **Edge Cases**: Socrata returns a 5xx or times out mid-sync for one zip → that zip's sync fails and is logged, but does not abort the loop for remaining zips (a single flaky zip shouldn't block the whole nightly sync). Socrata response shape doesn't match expected columns (schema drift) → validated and logged as a schema-mismatch error before any row reaches `loadIntoDb`, never silently coerced. Cron route hit without valid `CRON_SECRET` → `401`, no data fetched, no Socrata call made.
- **Files**: `web/lib/socrata.ts` (new), `web/lib/socrata.test.ts` (new), `web/app/api/cron/sync/route.ts` (new), `vercel.json` (new), `.env.example` (add `NYC_APP_TOKEN`, `CRON_SECRET` entries). 5 files, at cap.

[FORCES]
1. **Platform constraint correctness > architectural elegance** — Vercel's serverless model makes "scheduled HTTP endpoint" the only viable pattern for a recurring job; there is no daemon/cron-in-process alternative worth weighing here, so this spec doesn't debate design options, it implements the one Vercel actually supports.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by keeping `fetchOpenViolations`'s signature identical to `context/API_INTEGRATION.md` §2's already-designed function (`zip: string` only, no status parameter ever), rather than adding convenience parameters (e.g. an optional status override) that would violate the standing OPEN-only invariant for the sake of "flexibility."
4. **Fail-soft per-zip > fail-hard whole-sync** — a single zip's Socrata error must not abort the nightly sync for all other zips, since partial data (most zips refreshed, one stale) is strictly better than zero zips refreshed because of one transient failure; this is stated explicitly in Edge Cases so a builder doesn't wrap the entire zip loop in a single try/catch that aborts on first error.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- `web/app/api/cron/sync/route.ts` is a server-only API route — no client component involvement.
- No inline secrets — `NYC_APP_TOKEN` and `CRON_SECRET` from env vars only, `.env.example` documents both with placeholder values.
- No `any` types — Socrata's raw JSON response is typed via an explicit interface (`SocrataViolationRow`) before use, not left as `any`.
- Parameterized queries — the `SELECT DISTINCT postcode` query and the upsert calls into Phase 2's `loadIntoDb` use `pg`'s parameterized placeholders, consistent with Phase 2's established pattern.

### Build Constraints
- `npm run build` must PASS.
- No bundle-size impact — `socrata.ts` and the cron route are server-only, never bundled client-side.

### Test Constraints
- `web/lib/socrata.test.ts`: mocked-`fetch` unit tests covering the three Verification Oracle assertions above (OPEN-clause invariance, invalid-zip rejection, pagination looping).
- `npm test -- --run` GREEN on the full suite.
- No live-network calls in the automated test suite — CI has no `NYC_APP_TOKEN`/Socrata access guarantee; all Socrata interaction in tests is mocked.

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8 (`specs/011-playwright-setup.md`, planned). Once Phase 8/9 exist, a smoke E2E hitting `/api/cron/sync` with a valid `CRON_SECRET` against a test Postgres instance would be a natural follow-up, not required by this spec.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- `fetchOpenViolations` (not `fetchViolations` or `getData`) — name states the OPEN-only invariant directly in the identifier, matching `context/API_INTEGRATION.md`'s own naming.
- `CRON_SECRET`, `NYC_APP_TOKEN` — `UPPER_SNAKE_CASE` env var names per project convention.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — `SocrataViolationRow` interface defined for the raw API response shape (all-string fields per `context/API_INTEGRATION.md` §5, cast explicitly where numeric/boolean values are needed, matching that doc's documented casting guidance).

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) — no new dependencies.
- `NYC_APP_TOKEN` sent via header only, never query string (per `context/API_INTEGRATION.md` §4/§8).
- `CRON_SECRET` validated on every request to `/api/cron/sync` before any Socrata call or DB write — unauthenticated requests get `401` with no side effects.
- Zip is the only dynamic SoQL input, validated `/^\d{5}$/` before interpolation (restates existing project invariant, verified by this spec's own oracle).

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] socrata: add fetchOpenViolations client per API_INTEGRATION.md`
  2. `[test] socrata: add mocked-fetch tests for OPEN-invariance, validation, pagination`
  3. `[feat] cron: add /api/cron/sync route with CRON_SECRET auth`
  4. `[chore] vercel: add cron schedule config`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: mocked-fetch tests green; manual cron-trigger verification documented in the PR description.
