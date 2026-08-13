[SPEC]
- **Objective**: Write real feature E2E tests for zip search and building detail, covering US-1/US-2/US-3/US-4's browser-visible acceptance criteria, building on Phase 8's proven Playwright setup (`specs/011-playwright-setup.md`). **Correction to source-doc assumptions**: `context/product/open-violation-e2e-testing-setup.md` §1.3's example tests assume a `<table>`-based results UI (`page.getByRole('table')`, `table tbody tr`) — the actual built UI (`web/app/page.tsx`, `web/components/BuildingCard.tsx`) renders a card list, not a table, and routing is single-page state (not `/{zip}` URL navigation via `page.waitForURL`). This spec's tests are written against the real DOM structure that exists today, not the doc's illustrative example markup.
- **Inputs/Outputs**:
  - Output: `web/e2e/features/zip-search.spec.ts` — tests: (a) zip input is visible on load; (b) entering a non-5-digit zip and submitting shows a validation/error state (matches `web/lib/validation.ts`'s existing `/^\d{5}$/` rule surfaced via the API's 400 response, per `web/app/page.tsx`'s existing `error` state rendering); (c) entering a valid zip with known data (e.g. `11106`) shows the summary stat cards and at least one `BuildingCard`; (d) building cards render in worst-first order (lower `rating`/`score` first — asserted by reading the visible score text on the first two cards, matching `BuildingCard.tsx`'s `RatingBadge`'s `rating.toFixed(1)` display, not by assuming a `<table>` structure).
  - Output: `web/e2e/features/building-detail.spec.ts` — tests: (a) clicking a `BuildingCard` expands it (matches the existing `toggle()`/`expanded` state behavior, not a navigation to a separate detail page — the app has no per-building route today, only an expand/collapse card); (b) expanded card shows violation entries grouped by entrance, matching `BuildingCard.tsx`'s existing `byEntrance` grouping.
  - Output: `web/e2e/helpers/navigation.ts` — reusable helpers (`searchZip(page, zip)`, `expandFirstBuilding(page)`) written against the real DOM, replacing the source doc's table-oriented helper examples.
- **Design Pattern**: Page-Object-lite helper functions (`web/e2e/helpers/navigation.ts`) rather than a full Page Object Model class hierarchy — matches the source doc's own §1.5 "Test Helpers" convention (plain async functions, not classes), appropriate for this app's current UI complexity.
- **Bounded-AI boundary**: 100% deterministic. All assertions check literal DOM text/visibility/order against known API/DB state (e.g., "score text on card 1 <= score text on card 2"), never an LLM-judged visual or semantic check. This restates and applies Phase 8's own noted Bounded-AI boundary for Playwright test content.
- **Verification Oracle**: `npx playwright test e2e/features/zip-search.spec.ts e2e/features/building-detail.spec.ts` passes on all 4 configured browser projects, against a Postgres instance seeded with the same known-zip fixture data used in Phase 2's regression oracle (zip 11106, 818 buildings). This is the primary oracle for US-1/US-2/US-3/US-4's acceptance criteria going forward — future UI changes that break these flows will be caught here, not just by unit tests.
- **Intellectual Control**: Writing these tests against the actual rendered DOM (verified by reading `web/app/page.tsx` and `web/components/BuildingCard.tsx` directly in this spec, not copied from the source doc's illustrative-but-inaccurate example) prevents the exact failure mode jazz flagged in the "Confusion" section of the refactor context packet — a builder blindly copying the doc's table-based selectors would produce tests that fail immediately against the real card-based UI, for reasons unrelated to actual feature correctness.
- **Constraints**: Tests must run against seeded Postgres data (Phase 2's fixture, zip 11106), not mocked API responses — matches spec 001's existing "assert via integration test hitting real loaded data, not a mock" oracle style, extended to E2E scope. No new dependencies beyond Phase 8's `@playwright/test`.
- **Edge Cases**: Zip with zero buildings (e.g., a valid-format zip not present in the loaded data) → test asserts the existing "no violations found" empty state renders, not an error. Slow API response → tests must use Playwright's `waitFor`/auto-retrying assertions (`expect(locator).toBeVisible()`), never a bare `page.goto()` followed immediately by an assertion with no wait, per the source doc's own §"Test Flakiness on CI" troubleshooting guidance.
- **Files**: `web/e2e/features/zip-search.spec.ts` (new), `web/e2e/features/building-detail.spec.ts` (new), `web/e2e/helpers/navigation.ts` (new), `web/e2e/helpers/test-data.ts` (new — known-zip fixture constants, e.g. `TEST_ZIPS.LOADED = '11106'`, adapted from the source doc's §1.5 but pointed at this project's actual verified data). 4 files, under cap; references `web/app/page.tsx` and `web/components/BuildingCard.tsx` (2 references, for DOM-structure accuracy, under the 3-reference cap).

[FORCES]
1. **Real-DOM accuracy > source-doc fidelity** — this spec deliberately deviates from `context/product/open-violation-e2e-testing-setup.md`'s illustrative table-based test examples, because writing tests against markup that doesn't exist would produce a spec that fails on day one for reasons having nothing to do with the feature being tested. The source doc is a pattern reference (TDD workflow, directory layout, hook config), not a literal DOM contract for this specific app.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by keeping the doc's helper-function style (plain async functions in `e2e/helpers/`) rather than simplifying further into inline test code, preserving the doc's intended reusability pattern even while correcting its DOM assumptions.
4. **Correction, not open question**: per this spec's own framing (matching the human's explicit instruction pattern for Phase 12's cookie correction), the table-vs-card DOM mismatch is resolved here directly — tests are written against the real UI — rather than left as an ambiguity for `wheeljack` to discover and guess about mid-build.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`: not directly applicable to test files themselves, but the tests validate the skill's own patterns indirectly (e.g., asserting the zip input has a proper `label`/`aria-label` per the Accessibility constraints in `native_ai/.claude/INDUSTRY-BEST-PRACTICES.md` §3 — if `web/app/page.tsx`'s zip input lacks an accessible label, this spec's `page.getByLabel('...')`-style selector will fail, surfacing that gap rather than working around it with a fragile CSS selector).

### Build Constraints
- `npm run build` must PASS (no application code changed by this spec — test-only).

### Test Constraints
- `npm test -- --run` (Vitest) must remain GREEN — unaffected, this spec adds no Vitest tests.

### E2E Test Constraints
- `npx playwright test e2e/features/zip-search.spec.ts e2e/features/building-detail.spec.ts` must PASS on all 4 configured browser projects.
- Must be GREEN before this spec is considered complete — primary oracle, per above.
- Test files: `web/e2e/features/zip-search.spec.ts`, `web/e2e/features/building-detail.spec.ts`.

### Lint Constraints
- `npm run lint` must PASS (0 violations) on all new files.

### Naming Constraints
- `searchZip`, `expandFirstBuilding` (not `search`/`click1`) — descriptive helper names.
- `TEST_ZIPS.LOADED`, `TEST_ZIPS.INVALID`, `TEST_ZIPS.EMPTY` — descriptive constant names for the three zip-state scenarios tested.

### Type Constraints
- `npm run type-check` must PASS (0 errors) — no `any` types in helper functions or test files; `Page`/`Locator` types from `@playwright/test` used explicitly.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) — no new dependencies.
- No secrets involved — tests run against a seeded test database, no production credentials referenced.

### Commit Constraints
- Recommended commit sequence:
  1. `[test] e2e/helpers: add navigation and test-data helpers matching real DOM structure`
  2. `[test] e2e/features: add zip-search spec (US-1, US-2, US-3)`
  3. `[test] e2e/features: add building-detail spec (US-4)`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`, `npx playwright test e2e/features/`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: both feature spec files green on all 4 browser projects against seeded zip-11106 data.
