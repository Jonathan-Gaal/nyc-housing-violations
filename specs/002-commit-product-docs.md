[SPEC]
- **Objective**: Commit the three untracked "Open Violation" product-pivot docs (`context/product/*`) as a clean baseline commit before any refactor code lands, so every subsequent spec in this refactor sequence diffs against a stable, versioned reference rather than working files that could still be edited out from under a build.
- **Inputs/Outputs**: Input: three existing untracked files on disk (confirmed via `git status --short` showing `?? context/product/`). Output: one git commit adding exactly those three files, nothing else. No code, schema, or config changes in this spec.
- **Design Pattern**: none — simple case (a git add + commit, not a code change).
- **Bounded-AI boundary**: 100% deterministic — this is a file-system/git operation with no scoring, ranking, or generated content. No LLM involvement of any kind.
- **Verification Oracle**: `git log -1 --stat` shows a commit whose only changes are the three files `context/product/open-violation-product-spec.md`, `context/product/open-violation-system-prompt.md`, `context/product/open-violation-e2e-testing-setup.md` (all additions, no modifications elsewhere); `git status --short` afterward shows no `??` entries for `context/product/`.
- **Intellectual Control**: Establishes a clean commit boundary so later specs (Phases 1-13) can be reviewed and reverted independently of this one; keeps "docs landed" and "code changed" as separable, auditable git history events, consistent with this project's one-commit-per-feature-chunk discipline (`context/product/open-violation-system-prompt.md` §13.5, applied here even though this phase predates any of that doc's other content taking effect).
- **Constraints**: No new dependencies. No file outside `context/product/` may be touched by this commit. Commit message must follow this project's existing convention (see `specs/001-zip-search-and-buildings-summary.md`'s repo history for the established style) — plain descriptive summary, no `[US-X]` tag since this isn't a user-story-driven change.
- **Edge Cases**: If any of the three files has already been modified from what jazz's context packet described (e.g., mid-session edits), stop and re-confirm with jazz/human before committing — do not commit unreviewed drift. If `git status --short` shows unrelated unstaged changes, this spec's commit must not sweep them in (`git add` the three files explicitly, never `git add -A`).
- **Files**: `context/product/open-violation-product-spec.md`, `context/product/open-violation-system-prompt.md`, `context/product/open-violation-e2e-testing-setup.md` (3 files, all additions — no existing files modified).

[FORCES]
1. **Clean git history > convenience of bundling with Phase 1** — landing these as their own commit means a `git blame`/`git log` on the Postgres migration (Phase 1) won't be muddied by unrelated doc additions, and a revert of "these docs were wrong" doesn't also revert working code.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — not actually invoked by this spec (there is no pattern choice to make in a git-add), noted for completeness per the standing project rule.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`: not applicable — this spec touches no application code, no pages, no API routes, no database code. No skill patterns apply to a documentation-only commit.

### Build Constraints
- `npm run build` must still PASS after this commit (it will — no code changed).
- No bundle-size implication (no code changed).

### Test Constraints
- `npm test` (Vitest) must remain GREEN at 37/37 — this commit cannot touch any file under `web/`, so the existing suite is unaffected by construction.

### E2E Test Constraints
- Not applicable yet — Playwright doesn't exist until Phase 8. No E2E test is expected or required for this spec.

### Lint Constraints
- `npm run lint` (ESLint, scoped to `web/`) must remain PASS — unaffected, no files under `web/` touched.

### Naming Constraints
- Not applicable — no code identifiers created by this spec. File names for the three docs are already fixed by jazz's context packet; do not rename them.

### Type Constraints
- Not applicable — no TypeScript touched. `tsc --noEmit` remains unaffected.

### Security Constraints
- No secrets, API keys, or `.env` content in the three docs (confirmed by jazz's read-through — the docs describe target-state secret *names* like `NYC_APP_TOKEN`/`FIREBASE_ADMIN_SDK_KEY`, never actual values). `npm audit` unaffected — no dependency changes.

### Commit Constraints
- One commit, containing exactly the three named files.
- Commit message: `docs: add Open Violation product-pivot reference docs` (or equivalent descriptive summary) — plain prose body noting these are target-state/aspirational per jazz's packet, not yet-built state, to prevent a future reader from mistaking them for current architecture.
- All tests GREEN before commit (they already are, and this commit cannot change that).

### Pre-Push Constraints
- `git status --porcelain` clean after commit.
- Full existing suite (`npm run build`, `npm test`, `npm run lint`) still green — no regression possible given the file scope, but must be confirmed rather than assumed.
