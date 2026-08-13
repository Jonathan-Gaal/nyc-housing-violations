[SPEC]
- **Objective**: Install and configure Playwright per `context/product/open-violation-e2e-testing-setup.md` Part 1, with a single smoke test proving the setup works end-to-end (dev server boots, browser launches, page loads). This is deliberately scoped to setup + one smoke test only — the real feature E2E specs (zip search, building detail) are Phase 9 (`specs/012-playwright-feature-specs.md`), kept separate so a config mistake here doesn't get conflated with a feature-test failure there.
- **Inputs/Outputs**:
  - Output: `web/playwright.config.ts` — direct adoption of `context/product/open-violation-e2e-testing-setup.md` §1.1's documented config (4 browser projects: Chromium, Firefox, WebKit, Mobile Chrome; `webServer` block running `npm run dev` against `http://localhost:3000`; HTML/JSON/JUnit reporters; screenshot/video on failure).
  - Output: `web/e2e/smoke/health.spec.ts` — one test: navigate to `/`, assert the page loads and the zip-search input is visible (matches the doc's own directory-layout convention, §1.2's `e2e/smoke/health.spec.ts` placement).
  - Output: `web/package.json` — new scripts (`e2e`, `e2e:ui`, `e2e:debug`, `e2e:headed`) per §2.2's documented script names, and `@playwright/test` added to `devDependencies`.
- **Design Pattern**: Direct adoption of the source doc's own documented Playwright config — no customization beyond what's needed to point `baseURL`/`webServer` at this project's actual dev command (`npm run dev`, already correct in the doc's own example) and confirming the 4-browser-project list matches what's actually installed via `npx playwright install`.
- **Bounded-AI boundary**: 100% deterministic — Playwright config and the smoke test are plain TypeScript/config, no LLM-generated test assertions. (Note for future specs in this Phase 8/9/10 group: Playwright test *content* for feature specs, once written, must assert against real, deterministic UI state — e.g., "score is visible," "buildings are sorted ascending" — never an LLM-judged "looks right" assertion, consistent with this project's Bounded-AI rule.)
- **Verification Oracle**: `npx playwright test e2e/smoke/health.spec.ts` passes on all 4 configured browser projects (Chromium, Firefox, WebKit, Mobile Chrome) — `npx playwright test --list` confirms 4 test instances (1 test × 4 projects) are discovered, and `npx playwright test` exits 0.
- **Intellectual Control**: Keeping this spec to "config + one trivial smoke test" means the Verification Oracle is unambiguous — if the smoke test fails, the problem is definitionally in the Playwright setup itself (browser install, dev-server boot, config wiring), not in application logic, which would be conflated if this spec also tried to write real feature tests.
- **Constraints**: `npx playwright install` (browser binaries) must be run and documented as a required local/CI setup step — this is not an npm dependency but a separate binary-download step the doc itself calls out (§1.1's setup commands); note this explicitly since it's easy to miss and would make the Verification Oracle fail for a reason unrelated to the spec's actual code. No changes to any application code (`app/`, `components/`, `lib/`) in this spec — pure test-infrastructure addition.
- **Edge Cases**: WebKit or Firefox unavailable/failing to install in a given CI/sandbox environment → document this as an environment limitation, not a spec failure, and note which browser projects were actually verified locally if not all 4 could be confirmed in this pass.
- **Files**: `web/playwright.config.ts` (new), `web/e2e/smoke/health.spec.ts` (new), `web/package.json` (add scripts + `@playwright/test` devDependency), `.gitignore` (add `playwright-report/`, `test-results/` per the doc's §1.2 note). 4 files, under cap.

[FORCES]
1. **Isolated, unambiguous smoke test > combined setup-and-feature-test commit** — separating "does Playwright work at all" from "does the zip-search feature work" (Phase 9) means a red result always points at exactly one layer, consistent with this project's Verification Oracle discipline of naming the exact place a failure is observable.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by adopting the source doc's config verbatim rather than a minimal/simplified version (e.g., could have configured just Chromium for speed), since consistency with the documented target-state config is worth the extra CI time for a teachable reference implementation.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`: not directly applicable — this spec adds test infrastructure only, no application code (Server/Client Component boundaries, Zod, cookies, queries, secrets are all out of scope for a pure Playwright-config spec).

### Build Constraints
- `npm run build` must PASS (unaffected — no application code touched).
- No bundle-size implication (`@playwright/test` is a dev-only dependency, never shipped).

### Test Constraints
- `npm test -- --run` (Vitest) must remain GREEN — this spec adds no Vitest tests, only Playwright ones, so the existing suite is unaffected by construction.

### E2E Test Constraints
- Playwright smoke test: `npx playwright test e2e/smoke/health.spec.ts` must PASS on all 4 configured browser projects.
- Test file location: `web/e2e/smoke/health.spec.ts`, per the source doc's own directory convention.
- Must be GREEN before this spec is considered complete — this is the spec's primary oracle, not a supplementary check.

### Lint Constraints
- `npm run lint` must PASS (0 violations) — configure ESLint to recognize `web/e2e/**` if the existing config doesn't already include it (Playwright test files use `test`/`expect` globals from `@playwright/test`, not Vitest's).

### Naming Constraints
- Test file: `health.spec.ts` (matches Playwright's `**/*.spec.ts` convention configured in `playwright.config.ts`'s `testMatch`).
- Scripts named exactly as documented (`e2e`, `e2e:ui`, `e2e:debug`, `e2e:headed`) for consistency with `context/product/open-violation-e2e-testing-setup.md`'s own command references, which later specs (Phase 9, Phase 10) will assume exist under these names.

### Type Constraints
- `npm run type-check` must PASS (0 errors) — `playwright.config.ts` and the smoke spec are valid TypeScript, using `@playwright/test`'s exported types (`test`, `expect`, `devices`), no `any`.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after adding `@playwright/test`.
- No secrets involved in this spec.

### Commit Constraints
- Recommended commit sequence:
  1. `[chore] playwright: add config (4 browser projects) and devDependency`
  2. `[test] e2e: add smoke test verifying dev server + page load`
  3. `[chore] gitignore: add playwright-report/, test-results/`
- All tests GREEN before each commit (both the existing Vitest suite and the new smoke test, once it exists).

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`, plus the new `npx playwright test e2e/smoke/health.spec.ts`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: smoke test green on all 4 browser projects (or documented environment limitation if fewer were verifiable in this pass, per Edge Cases above).
