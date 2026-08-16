[SPEC]
- **Objective**: UI half of favorites — a `/favorites` page listing saved buildings/landlord profiles, and save/unsave buttons on `web/components/BuildingCard.tsx` and `web/app/landlord/page.tsx`, all built against spec 019's `GET/POST/DELETE /api/favorites` route. **Depends on spec 019** (schema, query lib, API route — referenced, not touched here). Premium-gating/paywall treatment of this page is **spec 020**, which depends on this spec and edits this page's file in place; this spec's page renders the favorites list only, no tier check.
- **Human-approved scope note**: proceeds under the same 2026-08-12 human override recorded in specs 014-016, plus the 2026-08-16 human decision authorizing favorites now.
- **Split note (2026-08-16, per coordinator correction)**: this is the UI half of what was originally drafted as one "favorites" spec (see spec 019's own Split note for the full reasoning) — split out specifically so both halves stay at or under this project's hard 5-file GRANULARITY cap.
- **Inputs/Outputs**:
  - Output: `web/app/favorites/page.tsx` (new) — Client Component (needs `useAuth()` + `fetch` for the favorites list, same interactivity exception class as `web/app/landlord/page.tsx`'s existing data-fetch pattern), styled to match `BuildingCard.tsx`'s dark-mode-aware card shell (`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800`, etc.). Fetches `GET /api/favorites` on mount, renders saved buildings as `BuildingCard` components (reusing the existing component directly, not a new rendering path) and saved landlord profiles as simple cards linking to `/landlord?...`. Page is already covered by `middleware.ts`'s `PROTECTED_PATHS` (spec 019 added `/favorites` there in anticipation of this page).
  - Output (edit): `web/components/BuildingCard.tsx` — a save/unsave star or bookmark icon button added near `RatingBadge` (top-right of the card header, not disrupting the existing `layout="stacked" | "inline"` row logic). Uses `useAuth()` to check `user !== null` before rendering as clickable; calls `POST`/`DELETE /api/favorites` with `type: 'building', key: building.building_id`. Local optimistic `useState` toggle, reverted on a failed request.
  - Output (edit): `web/app/landlord/page.tsx` — same save/unsave control added near the existing `StarRating`/tier badge row, using `type: 'landlord', key: profile.landlordKey`.
  - Output: `web/e2e/features/favorites.spec.ts` (new) — Playwright coverage, see Verification Oracle.
- **Design Pattern**: Reuses `BuildingCard.tsx` directly for saved-building rendering on `/favorites` rather than a parallel/lighter rendering path — one canonical building-card renderer, per this project's Pattern-purity-over-simplicity override.
- **Bounded-AI boundary**: 100% deterministic. The save/unsave toggle is a plain client-side fetch to spec 019's API; no LLM involvement anywhere in this spec.
- **Verification Oracle**: `web/e2e/features/favorites.spec.ts` (Playwright, requires a logged-in test session — may be marked skipped without live Firebase/Supabase credentials per this project's existing credential-blocked precedent, spec 016's E2E Test Constraints): clicking the save button on a `BuildingCard` toggles its visual state and the building subsequently appears on `/favorites`; clicking unsave on `/favorites` removes it from the list. `npm run build`, `npm run type-check`, `npm run lint` all PASS.
- **Intellectual Control**: The save button's `useAuth()`-gated clickability is a UX nicety only — the actual enforcement is spec 019's `verifySessionCookie()` check inside the API route; a logged-out user who somehow triggers the fetch anyway gets a clean `401`, not a crash, since this spec never assumes the client-side auth check is sufficient on its own.
- **Constraints**: No FK-level guarantee that a favorited `resource_key` still resolves to a real row (spec 019's Schema decision) — this page must defensively handle a favorite whose joined building/landlord data is missing (Edge Cases), never crash on a partial `GET /api/favorites` response. Save/unsave buttons call spec 019's existing API contract exactly (`{ type, key }` body shape) — no new endpoint or param shape invented here.
- **Edge Cases**: Save button clicked while logged out → button either renders as a disabled/login-prompt state (via `useAuth()`'s `user === null`) or, if clicked, the `401` response surfaces an inline "sign in to save" message — never a silent failure with no user feedback. Empty favorites list → `/favorites` renders an explicit "No saved buildings or landlords yet" empty state, not a blank page. A favorite whose `resource_key` no longer resolves (per spec 019's Edge Cases) → rendered as an "unavailable" placeholder or omitted, matching whatever spec 019's `GET` response actually returns for that case, not assumed independently here.
- **Files**: `web/app/favorites/page.tsx` (new), `web/components/BuildingCard.tsx` (edit), `web/app/landlord/page.tsx` (edit), `web/e2e/features/favorites.spec.ts` (new). 4 files, under cap. References: spec 019 (the API this spec's UI calls, depended on) — 1 reference, well under cap.

[FORCES]
1. **One canonical `BuildingCard` renderer > a lighter parallel favorites-card component** — reusing the existing component keeps saved-building presentation identical to every other place it's rendered (search results, browse-all), rather than a second implementation that could drift.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by reusing `BuildingCard.tsx` directly rather than a copy-pasted lighter version built just for this page.
4. **UI-only split, genuinely under the file cap > bundling with spec 019's backend** — per the Split note above: keeping schema/API and UI in separate specs means each is independently buildable/testable and neither exceeds GRANULARITY's hard 5-file limit.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- `web/app/favorites/page.tsx` is a documented `'use client'` exception (needs `useAuth()` + `fetch` on mount), consistent with how `web/app/landlord/page.tsx` already does the same for its own data fetch.
- No `any` types.
- Auth checks server-side only (Hard Rule #4) — the save button's disabled-while-logged-out UI is a UX nicety, not the actual enforcement; spec 019's `/api/favorites` route is the real boundary.

### Build Constraints
- `npm run build` must PASS.

### Test Constraints
- `npm test -- --run` GREEN on the full suite (no regressions from the `BuildingCard.tsx`/landlord-page edits).

### E2E Test Constraints
- `web/e2e/features/favorites.spec.ts`: save/unsave toggle and favorites-list round-trip, per the Verification Oracle above. If it requires a real logged-in Firebase session unavailable in this environment, mark it skipped with an explicit comment (not silently deleted), matching this project's existing credential-blocked precedent (spec 016's Stripe-integration E2E note).

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- Save/unsave button: descriptive `aria-label` ("Save building"/"Remove from favorites" or equivalent), not an icon-only control with no accessible name.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — favorites list response typed against spec 019's `listFavoritesForUser` return shape.

### Security Constraints
- No client-side trust of a logged-out user's ability to save — `useAuth()`'s `user !== null` check is UI convenience only, per Intellectual Control above.

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] BuildingCard: add save/unsave button`
  2. `[feat] landlord: add save/unsave button`
  3. `[feat] favorites: add /favorites page listing saved buildings and landlords`
  4. `[test] favorites: add e2e coverage for save/unsave and list round-trip`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: e2e save/unsave-and-list-round-trip green or explicitly skip-marked per the credential-blocked precedent.
