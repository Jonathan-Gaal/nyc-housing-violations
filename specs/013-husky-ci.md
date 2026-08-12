[SPEC]
- **Objective**: Add Husky pre-commit/pre-push hooks and a GitHub Actions CI workflow, per `context/product/open-violation-e2e-testing-setup.md` Part 2 and Part 6, building on Phase 8/9's now-real Playwright suite (`specs/011-playwright-setup.md`, `specs/012-playwright-feature-specs.md`) and Phase 1's Postgres schema (`specs/003-postgres-schema-driver.md`) for CI's database needs. This is additive to, not a replacement for, this project's existing Test-Before-Commit discipline (`../../../../.claude/BUILD-PROCESS.md`) — Husky automates enforcement of a rule this project already follows manually.
- **Inputs/Outputs**:
  - Output: `.husky/pre-commit` — runs `npm run test:pre-commit` (lint + type-check + Vitest unit tests), per the source doc's §2.3 documented behavior.
  - Output: `.husky/pre-push` — runs `npm run test:pre-push` (build + Vitest with coverage + full Playwright suite), per §2.4.
  - Output: `web/package.json` — new scripts (`test:pre-commit`, `test:pre-push`, `test:all`) per §2.2's documented script names (`type-check` already exists as of `specs/003-postgres-schema-driver.md`), `husky`/`lint-staged`/`@vitest/coverage-v8` added to `devDependencies`, a `lint-staged` config block. **Amended 2026-08-12 (shockwave):** `lint-staged` config covers `*.{ts,tsx}` (eslint --fix) only, not `*.{json,md}` — see amendment note below.
  - Output: `.github/workflows/test.yml` — GitHub Actions workflow per §6, **adapted for Supabase**: the source doc's example spins up a local `postgres:15` service container for CI, but this project's locked decision is "no local Postgres, one real Supabase project" (`specs/003-postgres-schema-driver.md`'s Constraints) — this spec's CI workflow instead runs migrations and tests against a dedicated Supabase branch/schema (or the same free-tier project's pooled `DATABASE_URL` supplied as a GitHub Actions secret), NOT a `postgres:15` service container, to stay consistent with the earlier locked decision rather than silently reintroducing a local-Postgres CI environment the human explicitly ruled out for development.
- **Design Pattern**: Direct adoption of the source doc's Husky/lint-staged config and CI step sequence (lint → type-check → unit test → build → E2E), with the one Postgres-provisioning substitution noted above. No new testing pattern invented — this spec wires up automation around test commands that already exist by the time this spec builds (Phases 1-9 have already established `npm test`, `npm run build`, `npm run lint`, `npm run type-check`, and Playwright).
- **Bounded-AI boundary**: 100% deterministic — hook scripts and CI YAML are static configuration, no LLM-generated test logic or gating decisions. Pass/fail is determined entirely by exit codes of the underlying deterministic commands (lint, type-check, test, build, e2e).
- **Verification Oracle**: (a) `git commit` with a deliberately introduced lint violation (e.g., an unused variable) is blocked locally with a non-zero exit and a visible ESLint error — confirmed by attempting the commit and observing it fails, then reverting the violation and confirming a clean commit succeeds. (b) A pushed branch triggers the GitHub Actions workflow (visible in the repo's Actions tab) and it runs to completion (green or red, but it runs) including a step that successfully connects to the Supabase `DATABASE_URL` secret and runs migrations. (c) **Amended 2026-08-12:** `npm run test:coverage` (`vitest run --coverage`) exits 0 locally with `@vitest/coverage-v8` installed — this is the specific failure wheeljack hit and resolved; re-running this command is the direct oracle for the amendment itself.
- **Intellectual Control**: The Postgres-provisioning substitution (Supabase branch/secret instead of a local service container) is the one place this spec must deviate from the source doc's literal CI example — documented explicitly here so `ratchet`/a future reviewer doesn't flag the deviation as an unauthorized drift; it is a deliberate, locked-decision-consistent choice, not an oversight.
- **Constraints**: `husky`/`lint-staged` are new dependencies requiring shockwave authorization — granted in this spec. **Amended 2026-08-12 (shockwave):** `@vitest/coverage-v8` is also authorized as a new dependency, pinned to `^4.1.10` to match this project's already-installed `vitest`/`@vitest/ui` major.minor (Vitest requires matching versions between core and coverage provider). Approved because: (1) it is the official first-party provider published under the same `@vitest` scope as the already-authorized `@vitest/ui`, not a new vendor or new capability; (2) the source doc this spec was written from (`context/product/open-violation-e2e-testing-setup.md`) assumed coverage works out of the box, which stopped being true when Vitest 3+ unbundled the coverage provider into a separate package — this is a correction to an inaccurate premise in the source material, not scope creep; (3) it is dev-only (no production bundle impact, no new runtime/network/secret surface); (4) the feature it enables (`test:coverage`, composed into `test:pre-push`) was already required by this spec's own Test Constraints below — only the delivery mechanism was missing. wheeljack correctly halted per DEPENDENCY AUTHORITY rather than installing it unilaterally; this amendment is the resolution. CI must not use a shared/production Supabase project for test runs if avoidable — if Supabase branching (a paid-tier feature) isn't available on the free tier, CI should run migrations/tests against the same single free-tier project's schema with a clearly-namespaced test schema or table prefix, and this constraint/limitation must be documented in the workflow file's comments rather than silently sharing state with local development data. `CRON_SECRET`, `NYC_APP_TOKEN`, `DATABASE_URL`, and (once Phase 11+ land) Firebase/Stripe secrets must be supplied to CI exclusively via GitHub Actions repository secrets, never hardcoded in the workflow YAML.
- **Edge Cases**: A pre-commit hook that takes too long (full E2E is intentionally reserved for pre-push, not pre-commit, per the source doc's own split — pre-commit stays fast at ~45s, pre-push absorbs the ~5min E2E cost) — this spec must preserve that split, not accidentally run the full Playwright suite on every commit. `git commit --no-verify` / `git push --no-verify` bypass paths exist by design (Husky's own mechanism) — this spec does not attempt to prevent bypass (not technically enforceable client-side), but the CI workflow (server-side, unbypassable) is the actual enforcement backstop, which is why both layers are included in one spec rather than treating CI as optional.
- **Files**: `.husky/pre-commit` (new), `.husky/pre-push` (new), `web/package.json` (add scripts + `husky`/`lint-staged`/`@vitest/coverage-v8` devDependencies + `lint-staged` config), `.github/workflows/test.yml` (new). 4 files, under cap. (`package-lock.json` at repo root is a generated-by-install side effect of the `package.json` change, not a separately authored file, and is not counted against the cap.)

[FORCES]
1. **Consistency with the locked no-local-Postgres decision > literal source-doc fidelity** — the source doc's CI example uses a `postgres:15` service container, which is exactly the kind of "second environment to keep in sync" the human's locked decision #2 explicitly ruled out for local development; extending that same reasoning to CI (use the one real Supabase project, not a parallel local-in-CI Postgres) keeps the project's environment story genuinely single, not single-in-dev-but-dual-in-CI.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by keeping the source doc's full step sequence (lint, type-check, unit, build, E2E, artifact upload) rather than trimming CI down to a faster subset, since a complete, teachable CI reference is valued over a faster-but-partial one for this project.
4. **Amended 2026-08-12: Making an already-authorized feature actually work > strict "no new dependencies without a fresh spec" literalism** — `@vitest/coverage-v8` is authorized as a dependency-completion correction within this same spec rather than deferred to a new spec, because the feature (`test:coverage`) was already in scope and the gap was a source-doc inaccuracy about Vitest's packaging, not a new feature request.

## Amendment note (2026-08-12, shockwave)

This spec was amended mid-build, at wheeljack's request, per a formal dependency escalation (DEPENDENCY AUTHORITY rule) rather than a silent install. Everything else in this spec was already built, tested, and staged prior to this amendment and is **not** being redone.

**Approved**: `@vitest/coverage-v8@^4.1.10` added to authorized dependencies (see Constraints above for full reasoning). Added to `web/package.json` `devDependencies`.

**Deferred, not forgotten**: wheeljack also found that the `lint-staged` config's `*.{json,md}` → prettier rule (documented in the original Inputs/Outputs line above) is not implementable — `prettier` is not installed and was not authorized by this spec. wheeljack did not file a formal dependency request for this (correctly treated as discretionary, not blocking any Verification Oracle — no oracle in this spec depends on JSON/Markdown auto-formatting). Decision: **stays deferred**. The current `lint-staged` config in `web/package.json` covers `*.{ts,tsx}` only. If `prettier` + the `*.{json,md}` rule are wanted later, that requires its own dependency-authorization request/spec amendment — it is explicitly out of scope for this spec's completion and should not be assumed done.

Per re-entry process: this amended spec re-enters at spec review (optimus-prime), not directly back to wheeljack.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`: not directly applicable — this spec adds no application code, only tooling/CI config. Indirectly enforces the skill's own patterns (type-check, lint) as automated gates rather than manual discipline.

### Build Constraints
- `npm run build` must PASS both locally and as a CI step.
- No bundle-size implication — `husky`/`lint-staged`/`@vitest/coverage-v8` are dev-only dependencies.

### Test Constraints
- `npm test -- --run` must remain GREEN; `test:pre-commit` script must run it as one of its steps.
- `test:coverage` (Vitest with coverage) added as a pre-push-only step, per the source doc's split. **Amended 2026-08-12:** requires `@vitest/coverage-v8` (see Constraints above) — `npm run test:coverage` must exit 0 with this dependency installed; this is the direct proof the amendment resolved wheeljack's blocker.

### E2E Test Constraints
- `npm run e2e` (Playwright, from Phase 8) must be wired into both `test:pre-push` and the CI workflow.
- CI workflow must install Playwright browsers (`npx playwright install --with-deps`) as a documented step before running E2E.

### Lint Constraints
- `npm run lint` must PASS (0 violations); wired into both `test:pre-commit` and CI.
- `lint-staged` config scoped correctly (`*.{ts,tsx}` → eslint --fix), per source doc §2.2. **Amended 2026-08-12:** the source doc's `*.{json,md}` → prettier rule is deferred — `prettier` is not installed/authorized (see Amendment note above). Do not treat this line as satisfied until a future spec authorizes `prettier`.

### Naming Constraints
- Script names exactly as documented (`test:pre-commit`, `test:pre-push`, `test:all`; `type-check` already exists per Phase 1) — later reference material (this project's own `../../../../.claude/BUILD-PROCESS.md` and the source docs) assume these names.
- Workflow file: `.github/workflows/test.yml`, matching the source doc's own filename.

### Type Constraints
- `npm run type-check` (`tsc --noEmit`, already added in `specs/003-postgres-schema-driver.md`) must PASS (0 errors); wired into `test:pre-commit` and CI by this spec.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after adding `husky`/`lint-staged`/`@vitest/coverage-v8`.
- All CI secrets (`DATABASE_URL`, `NYC_APP_TOKEN`, `CRON_SECRET`) supplied via GitHub Actions repository secrets, referenced in the workflow YAML as `${{ secrets.NAME }}`, never hardcoded.
- Pre-commit/pre-push hook scripts contain no secrets themselves — they only invoke npm scripts that read from the developer's local `.env.local`, never embed values.

### Commit Constraints
- Recommended commit sequence:
  1. `[chore] husky: install and configure pre-commit hook (lint, type-check, unit tests)`
  2. `[chore] husky: configure pre-push hook (build, coverage, e2e)`
  3. `[chore] lint-staged: add config for staged-file linting`
  4. `[ci] github-actions: add test workflow with Supabase-backed migrations (no local Postgres service container)`
  5. `[chore] deps: add @vitest/coverage-v8 to unblock test:coverage (spec 013 amendment, 2026-08-12)`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run test:pre-push` itself (build, coverage, e2e) — this spec's own pre-push hook becomes the enforcement mechanism for all subsequent specs' pushes, so it must be proven working before being relied upon.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: a deliberate lint-violation commit is blocked; a real push triggers and completes the GitHub Actions workflow, connecting successfully to the Supabase `DATABASE_URL` secret; `npm run test:coverage` exits 0 locally with `@vitest/coverage-v8` installed.
