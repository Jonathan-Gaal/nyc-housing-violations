[SPEC]
- **Objective**: Backend infrastructure for favorites — let a signed-in user save/unsave a building (`buildings.building_id`) or landlord profile (`landlord_profiles.landlord_key`) against their `firebase_uid`, and list them back. Covers schema, query lib, and the API route only. UI (the `/favorites` page, save/unsave buttons on `BuildingCard.tsx`/`web/app/landlord/page.tsx`, and the e2e test) is **spec 021**, which depends on this spec. Premium-gating of this route is **spec 020**, which depends on this spec and edits this route's file in place (adding a `requirePremiumTier()` call) without touching this spec's schema or query lib.
- **Human-approved scope note**: proceeds under the same 2026-08-12 human override recorded in specs 014-016, plus the 2026-08-16 human decision authorizing favorites now.
- **Split note (2026-08-16, per coordinator correction)**: originally drafted as one "favorites" spec covering schema+API+UI+tests in a single file list of 5 "at cap" plus a documented commit-batch overflow to 9 total files. That overflow does not satisfy this project's GRANULARITY rule (`CLAUDE.md`: "No spec touches more than 5 files" — a hard reject enforced by optimus-prime, not a soft guideline satisfiable by sequencing commits within one spec). Split into this spec (schema + query lib + API + its own test + middleware, 5 files, genuinely at cap) and spec 021 (page + both save-button UI edits + e2e test, 4 files). No scope was dropped in the split — see spec 021 for the UI half.
- **Schema decision — one polymorphic table, not two**: `favorites` uses a single table with a `resource_type TEXT CHECK (resource_type IN ('building', 'landlord'))` discriminator and one `resource_key TEXT` column (holding either a `building_id` or a `landlord_key`), rather than separate `saved_buildings`/`saved_landlord_profiles` tables. Justification: both resource keys are already opaque `TEXT` primary keys in their own tables (`buildings.building_id`, `landlord_profiles.landlord_key`) with no differing column shape to preserve; a real foreign key to either table is not used (see Constraints — deliberately, so a save survives even if the referenced building/profile row is later deleted/re-synced by the data-loader, matching how `landlord_profiles` itself is a best-effort cache, not a stable join target). Two tables would mean two near-identical migrations, two query-lib modules, and either two API routes or the same `type`-param branching this spec needs anyway — one table with a `type` column and a composite unique constraint achieves the same result with less duplication, which is the simpler choice on its own merits (this project's Pattern-purity-over-simplicity override is about not skipping structure for expedience, not about preferring two tables when one is the natural, non-contorted shape for genuinely uniform data).
- **Inputs/Outputs**:
  - Output: `web/db/migrations/006_add_favorites.sql` (new) —
    ```sql
    CREATE TABLE IF NOT EXISTS favorites (
      id SERIAL PRIMARY KEY,
      firebase_uid TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
      resource_type TEXT NOT NULL CHECK (resource_type IN ('building', 'landlord')),
      resource_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (firebase_uid, resource_type, resource_key)
    );
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(firebase_uid);
    ```
    `resource_key` has no DB-level foreign key to `buildings`/`landlord_profiles` (deliberate — see Schema decision above); the query lib is responsible for left-joining against both tables and tolerating a missing match (Edge Cases). `firebase_uid` DOES have a real FK to `users`, cascading delete, so a deleted user's favorites are cleaned up automatically.
  - Output: `web/lib/favorites.ts` (new) — `getPool()`-pattern query functions: `listFavoritesForUser(pool, firebaseUid): Promise<{ buildings: Array<{ buildingId: string; ... }>; landlords: Array<{ landlordKey: string; ... }> }>` (a display-ready shape, joined against `buildings`/`landlord_profiles`, so spec 021's page can render without N+1 queries per favorite — exact joined columns are the builder's call, but must be enough to render a `BuildingCard`-compatible row and a landlord-summary row), `addFavorite(pool, firebaseUid, resourceType, resourceKey): Promise<void>` (idempotent — `ON CONFLICT (firebase_uid, resource_type, resource_key) DO NOTHING`, matching this project's existing idempotent-write pattern from `web/app/api/webhooks/stripe/route.ts`'s `setUserTier`), `removeFavorite(pool, firebaseUid, resourceType, resourceKey): Promise<void>`.
  - Output: `web/app/api/favorites/route.ts` (new) — single route file handling both resource types via a `type` query/body param (`'building' | 'landlord'`), per this spec's file-cap guidance:
    - `GET` — requires verified session cookie (`verifySessionCookie()`, `web/lib/firebaseAdmin.ts`, exact pattern from `web/app/api/auth/me/route.ts`: read cookie → verify → derive UID → only then query). Returns `{ buildings: [...], landlords: [...] }` (from `listFavoritesForUser`). No session → `401`, no DB call.
    - `POST` — body `{ type: 'building' | 'landlord', key: string }`. Same verified-session requirement. Validates `type` is one of the two allowed values and `key` is a non-empty string before calling `addFavorite`; malformed body → `400`, never reaches the DB.
    - `DELETE` — body `{ type: 'building' | 'landlord', key: string }`. Same verified-session requirement and validation, calls `removeFavorite`.
  - Output: `web/app/api/favorites/route.test.ts` (new) — unit tests, see Verification Oracle.
  - Output (edit): `web/middleware.ts` — `PROTECTED_PATHS` extended to `['/dashboard', '/account', '/favorites']`; `matcher` extended to include `'/favorites/:path*'`. (`/favorites` page itself doesn't exist until spec 021, but adding it to middleware here means spec 021 doesn't need to touch this file, keeping both specs' file lists accurate to what each actually does.)
- **Design Pattern**: Single-route, `type`-param dispatch (not a REST sub-resource split like `/api/favorites/buildings` + `/api/favorites/landlords`) — chosen specifically to stay under this spec's 5-file cap while still covering both resource types; the `resource_type` CHECK constraint at the DB layer and validation at the API layer are the two enforcement points that keep an invalid `type` from ever reaching a query, matching this project's existing pattern of validating untrusted input before it touches SQL (`CLAUDE.md`'s zip-regex-before-SoQL invariant, same spirit applied here).
- **Bounded-AI boundary**: 100% deterministic. Saving/unsaving is a plain existence toggle in Postgres; the favorites list is a plain SELECT/JOIN. No LLM involvement — no ranking, scoring, or summarization of favorites.
- **Verification Oracle**: `web/app/api/favorites/route.test.ts` unit tests: (a) `GET`/`POST`/`DELETE` with no session cookie or a cookie that fails `verifySessionCookie()` → `401`, no DB call made (mirrors spec 016's `/upgrade` test shape exactly); (b) `POST` with an invalid `type` value (e.g. `'landlordxyz'`) → `400`, `addFavorite` never called; (c) `POST` then `GET` with a valid session (mocked `verifySessionCookie()`, mocked `pg` pool) round-trips the saved resource into the `GET` response; (d) `POST` called twice with the same `{type, key}` does not throw or duplicate (idempotent, asserting the `ON CONFLICT DO NOTHING` path). `npm run build`, `npm run type-check`, `npm run lint` all PASS.
- **Intellectual Control**: Reusing `verifySessionCookie()`'s exact read-cookie-verify-derive-UID sequence (not middleware-only) is non-negotiable per this project's context packet — a favorites route that trusted middleware's presence-only check would repeat the Phase-12 auth-bypass class of bug this project has already fixed once (see spec 016's Amendment note for the precedent). The idempotent `ON CONFLICT DO NOTHING` write mirrors the webhook handler's idempotency reasoning (Stripe's at-least-once delivery) applied to a different but structurally identical problem: a double-click or retried request must not error or create a duplicate favorite.
- **Constraints**: No FK from `favorites.resource_key` to `buildings`/`landlord_profiles` (Schema decision above) — the query lib must defensively handle a `resource_key` with no matching row (Edge Cases), never assume the join always succeeds. `firebase_uid` FK to `users` cascades on delete so no orphaned favorites survive a user deletion. This spec's route requires only a verified session, not a tier check — spec 020 adds `requirePremiumTier()` on top of this same route file without needing to touch this spec's schema or query lib, per this spec's Objective note.
- **Edge Cases**: `GET /api/favorites` for a user whose saved `resource_key` no longer matches any row in `buildings`/`landlord_profiles` (e.g. the nightly data sync dropped that `building_id`) → that favorite is either omitted from the response or flagged as unavailable, never a crash from a failed join; builder's call on exact UX (omit vs. "no longer available" placeholder), but must not 500. `POST` for a resource that's already saved → `200`/no-op (idempotent, per Design Pattern), not a `409` or duplicate row. `DELETE` for a resource that was never saved → `200`/no-op, not a `404` (deleting a non-existent favorite is a valid no-op, not an error state).
- **Files**: `web/db/migrations/006_add_favorites.sql` (new), `web/lib/favorites.ts` (new), `web/app/api/favorites/route.ts` (new), `web/app/api/favorites/route.test.ts` (new), `web/middleware.ts` (edit). 5 files, at cap. References: spec 016 (`verifySessionCookie()`/idempotent-write patterns this spec follows), spec 020 (which will edit this spec's route file to add tier-gating, not built here), spec 021 (the UI that consumes this API, not built here). 3 references, at cap.

[FORCES]
1. **One schema, both resource types > two near-identical schemas** — per the Schema decision above; two opaque `TEXT`-keyed resources with identical save/unsave semantics do not need two tables to stay "pure," and forcing two tables here would be duplicating structure without duplicating meaning.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by mirroring `verifySessionCookie()`'s exact multi-step pattern rather than a shortcut cookie-presence check, even though the shortcut is fewer lines.
4. **Backend-first split, genuinely under the file cap > one oversized spec with a commit-batching workaround** — per the Split note above: GRANULARITY is a hard reject condition, not something a spec can satisfy by describing how it would sequence commits across more files than it's allowed to touch.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- `web/app/api/favorites/route.ts` is a server-only API route; `web/lib/favorites.ts` is server-only (imports `pg` via `getPool()`), never imported into a Client Component directly.
- No `any` types.
- Auth checks server-side only (Hard Rule #4) — this route's own `verifySessionCookie()` call is the real boundary; `middleware.ts`'s presence-only check (extended here to cover `/favorites`) is a cheap first gate only.

### Build Constraints
- `npm run build` must PASS.
- Migration `006_add_favorites.sql` runs cleanly against a fresh schema (idempotent `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`, matching migrations 001-005's own style) — confirmed by code review since no live Supabase credentials are available locally; not required to run against a real Supabase instance in this environment.

### Test Constraints
- `web/app/api/favorites/route.test.ts` covers all four Verification-Oracle unit-test assertions above, using mocked `verifySessionCookie()` and a mocked `pg` pool (matching spec 016's webhook-test mocking approach).
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- None in this spec — e2e coverage (requires the `/favorites` page and save buttons) is spec 021's responsibility.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- `favorites` table, `resource_type`/`resource_key` columns — generic names chosen deliberately (not `building_favorites`) since the Schema decision is one polymorphic table.
- Query lib functions: `listFavoritesForUser`, `addFavorite`, `removeFavorite` — verb-first, matching `web/lib/landlordProfile.ts`'s `getOrFetchLandlordProfile` naming shape.
- API route: `/api/favorites` (not `/api/favorites/buildings` etc.), matching the single-route `type`-param Design Pattern decision.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — `resource_type` typed as a `'building' | 'landlord'` union everywhere it appears (migration CHECK constraint, TS types, and API validation all agree on the same two literal values).

### Security Constraints
- `GET`/`POST`/`DELETE /api/favorites` all require `verifySessionCookie()` in the handler itself — never rely on `middleware.ts`'s presence-only check as the actual boundary, per Intellectual Control above.
- A user can only ever read/write favorites keyed to their own verified `firebase_uid` — the UID is derived from the verified session cookie, never accepted as a client-supplied body/query param (preventing one user from saving/reading another user's favorites by passing an arbitrary `firebase_uid`).
- `type`/`key` body params validated (allowed enum values, non-empty string) before touching SQL, consistent with this project's zip-regex-before-SoQL invariant applied to a different untrusted-input surface.

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] db: add favorites table migration (006)`
  2. `[feat] favorites: add query lib (list/add/remove) following getPool() pattern`
  3. `[feat] api/favorites: add session-verified GET/POST/DELETE route`
  4. `[feat] middleware: add /favorites to PROTECTED_PATHS`
  5. `[test] api/favorites: add route unit tests`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: all four route unit-test assertions green.
