[SPEC]
- **Objective**: Rescale the existing deterministic composite score from a 0–5 range to a 0–100 range, keeping the current 5-factor per-factor formulas (fixed-range count/percentage scales, exactly as documented in the 2026-08-11 point-budget resolution comment in `web/lib/scoring.ts`) unchanged. This is deliberately the *narrower* of the two scoring changes jazz flagged — it does NOT adopt product-spec's different per-factor formulas (percentage-of-total, max-in-zip normalization); that is Phase 4 (`specs/007-scoring-new-formulas.md`), kept separate per jazz's explicit warning not to conflate a rescale with a formula change. Builds on `specs/005-async-query-route-handlers.md`'s now-working Postgres read path.
- **Inputs/Outputs**:
  - Input/Output types unchanged: `ScoringInput` (`violationCount`, `rentImpairingCount`, `avgDaysOpen`, `percentDeadEnd`, `percentReissued`) stays identical — this spec changes only the arithmetic inside `calculateScore`, not its signature.
  - Output: `ScoringResult.score` now returns a value in `[0, 100]` instead of `[0, 5]`, still lower = worse landlord responsiveness (polarity unchanged — confirmed consistent old vs. new per jazz's audit, only scale differs).
  - Output: `web/lib/format.ts`'s `ratingTier()` thresholds (`>=4`, `>=3`, `>=1.5` today) rescaled by the same 20x factor (`>=80`, `>=60`, `>=30`) so the UI's excellent/good/fair/poor tiers land in the same relative position on the new scale.
- **Design Pattern**: none — simple case, a linear rescale of an already-correct deterministic formula (multiply the existing point-budget deduction structure by 20, or equivalently change the ceiling from 5 to 100 and each `POINT_BUDGET` entry from `weight * 5` to `weight * 100`).
- **Bounded-AI boundary**: 100% deterministic, unchanged from the existing rule documented in `web/lib/scoring.ts`'s file header and this project's `CLAUDE.md` — no LLM ever computes or influences the score. This spec's own change is itself a plain arithmetic rescale, performed as ordinary code, not generated/inferred.
- **Verification Oracle**: `web/lib/scoring.test.ts` updated with (a) a rescale-equivalence assertion — for a fixed set of `ScoringInput` fixtures, `calculateScore(input).score === oldScoreOnZeroToFive * 20` (computed inline in the test from the pre-rescale formula, not by importing old code, to keep the test self-contained) — and (b) a full regression re-run of the real-data spot-check from spec 001's oracle (one known building's `scoringBreakdown` manually verified) confirming the new 0–100 score for that same building is exactly 20x its previously-verified 0–5 score. `npm test -- --run` GREEN is the final oracle.
- **Intellectual Control**: A pure linear rescale is the lowest-risk possible change to a formula that already has a documented, human-resolved history (the 2026-08-11 point-budget contradiction fix, preserved inline in the file). Keeping this spec to *only* the rescale — no formula changes — means any bug introduced here is immediately visible as "the multiplier is wrong somewhere," not entangled with "did the new percentage-of-total formula also change the ranking." Phase 4 gets a clean, already-correctly-scaled 0-100 baseline to modify formulas against.
- **Constraints**: No new dependencies. `POINT_BUDGET` ceiling changes from summing to 5 to summing to 100 — the underlying weight fractions (0.25/0.25/0.20/0.15/0.15) and the inline 2026-08-11 resolution comment explaining *why* they're point-budgets (not literal 0-1 fractions) must be preserved and updated in place, not deleted, since that comment documents a real prior contradiction-resolution the project needs to keep visible. `web/lib/queries.ts`'s `withScoringBreakdown` mapping function must NOT need changes beyond what Phase 2 already introduced — the breakdown's component values (`totalViolations`, `avgYearsOpen`, etc.) are unscaled raw counts/percentages today and remain so; only the top-level `score` changes scale, not the breakdown fields.
- **Edge Cases**: Building with zero violations → `score = 100.0` (was `5.0`), all breakdown components = 0 — this must be asserted explicitly in the rewritten test, since "the max score is now 100 not 5" is exactly the kind of off-by-factor-of-20 bug this narrow rescale spec exists to prevent. Building maxed out on every factor → `score = 0.0` (unchanged floor, still reachable — same reasoning as the original 2026-08-11 point-budget fix, just at the new scale).
- **Files**: `web/lib/scoring.ts`, `web/lib/scoring.test.ts`, `web/lib/format.ts`, `web/lib/format.test.ts` (4 files — under cap; `web/lib/queries.ts` explicitly NOT touched by this spec per the Constraints note above, confirmed not needed).

[FORCES]
1. **Isolation of the rescale from the formula change > doing both at once for "efficiency"** — jazz explicitly flagged that conflating "rescale 0-5→0-100" with "adopt product-spec's different per-factor math" would make it impossible to tell, if a ranking looks wrong after Phase 4, whether the bug is in the rescale or the new formulas. This spec exists specifically to remove that ambiguity by proving the rescale alone is correct first.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by preserving the existing `POINT_BUDGET` object/comment structure exactly (rescaled, not restructured), keeping the code's documented reasoning trail intact rather than opportunistically simplifying the arithmetic during this touch.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- No `any` types in the rescaled `scoring.ts`/`format.ts` — unchanged from current state (already strictly typed).
- Not applicable this spec: Server Components, Zod, HttpOnly cookies, parameterized queries, Tailwind — this spec touches only pure scoring/formatting functions, no UI, no API routes, no database code.

### Build Constraints
- `npm run build` must PASS.
- No bundle-size impact (pure function change, no new imports).

### Test Constraints
- `web/lib/scoring.test.ts` and `web/lib/format.test.ts` both updated; full suite `npm test -- --run` GREEN.
- New test assertions required (not just updated thresholds): the rescale-equivalence check and the zero-violations/max-violations boundary checks described in Edge Cases above.
- Coverage: 100% of the changed arithmetic paths in `calculateScore` and `ratingTier` (small, fully-testable pure functions — full coverage is achievable and expected here, not just "80%").

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8 (`specs/011-playwright-setup.md`).

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- Keep `calculateScore`, `ScoringInput`, `ScoringResult`, `ScoringBreakdown`, `ratingTier`, `RatingTier` names unchanged — this spec changes values, not identifiers, consistent with the "pure rescale" framing.
- If a new named constant is introduced for the rescale factor (e.g., `SCORE_CEILING = 100`), name it for what it represents, not `MULTIPLIER` or `FACTOR`.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) — no dependency changes in this spec.
- No secrets involved — pure arithmetic, no env vars, no external calls.

### Commit Constraints
- Recommended commit sequence:
  1. `[refactor] scoring: rescale composite score from 0-5 to 0-100`
  2. `[refactor] format: rescale ratingTier thresholds to match 0-100 score`
  3. `[test] scoring/format: add rescale-equivalence and boundary assertions`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: rescale-equivalence assertions and the real-data spot-check (20x of spec 001's previously-verified value) both green.
