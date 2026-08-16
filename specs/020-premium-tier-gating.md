[SPEC]
- **Objective**: Gate the landlord-profile feature and favorites behind `tier === 'premium'`. Adds a reusable `requirePremiumTier()` helper (extending `verifySessionCookie()`'s exact pattern one step further with a DB tier lookup), applies it to `web/app/api/landlord/route.ts` and spec 019's `web/app/api/favorites/route.ts`, and adds matching paywall UI to `web/app/landlord/page.tsx` and spec 021's `web/app/favorites/page.tsx`. **Depends on spec 019** (favorites API route this spec edits) **and spec 021** (favorites page this spec edits, and the save-button UX this spec's paywall must not break) — both referenced, not otherwise duplicated here. In-app payment itself (letting a user actually become premium) is **spec 022**, which depends on this spec existing (needs `tier` semantics and, incidentally, reuses `requirePremiumTier()`'s pattern for consistency but does not call it directly).
- **Human-approved scope note**: proceeds under the 2026-08-12 override (specs 014-016) plus the 2026-08-16 human decision authorizing premium gating for landlord/favorites.
- **Split note (2026-08-16, per coordinator correction)**: originally drafted as one "premium gating + in-app payment" spec covering the tier helper, both paywalls, the upgrade-route rewrite, a new payment page, the webhook edit, and the signup hand-off, with a documented multi-batch overflow to roughly 13 total files. That does not satisfy this project's hard GRANULARITY cap. Split into this spec (gating only: helper + both route edits + both page paywalls, no payment mechanism) and spec 022 (payment mechanism: upgrade-route rewrite, new payment page, client SDK) plus spec 023 (webhook event correction + signup-page payment hand-off wiring) for the payment side. No scope was dropped — see specs 022/023 for the payment mechanism.
- **Inputs/Outputs**:
  - Output: `web/lib/requirePremiumTier.ts` (new) — mirrors `verifySessionCookie()`'s exact pattern from `web/lib/firebaseAdmin.ts`, extended one step further: read cookie (`cookies()`) → `verifySessionCookie()` → derive UID → **DB lookup of `users.tier` by that UID** (`getPool()`) → only if `tier === 'premium'`, return the verified user; otherwise return a discriminated result the caller can branch on (`{ authorized: false, reason: 'unauthenticated' | 'not-premium' }` vs `{ authorized: true, uid, email }`) so callers can distinguish "not logged in" (401) from "logged in but free tier" (403) — the two need different client-side messaging ("sign in" vs. "upgrade to premium"). No standalone unit test file for this helper (see Test Constraints — its branches are exercised through the route tests below to stay within this spec's file cap; the helper is thin enough that this is full, not partial, coverage).
  - Output (edit): `web/app/api/landlord/route.ts` — calls `requirePremiumTier()` before the existing `getOrFetchLandlordProfile` call; unauthenticated → `401`; authenticated-but-free → `403` with a body shape the client can key off (`{ error: 'premium_required' }`); premium → existing behavior unchanged. Existing/extended test coverage for this route (in its own test file, already implied by the route's existence — not a new file added by this spec, an extension of what should already exist) covers `requirePremiumTier()`'s three branches end to end.
  - Output (edit): `web/app/api/favorites/route.ts` (spec 019's file) — adds the same `requirePremiumTier()` call (`401`/`403 premium_required`/pass-through) to `GET`/`POST`/`DELETE`, replacing spec 019's `verifySessionCookie()`-only check. Existing test coverage in spec 019's `route.test.ts` is extended in place for the new tier branches.
  - Output (edit): `web/app/landlord/page.tsx` — on `403 premium_required` (or on `useAuth()` reporting `tier !== 'premium'` before even calling the API, as a UX head-start), renders a paywall card in place of the profile content: message + a button reading exactly **"Sign up for Landlord Profile"** linking to `/signup?intent=premium&callbackUrl=<current landlord URL, URL-encoded>`. If the user IS logged in but free-tier (not signed out), the same paywall card's CTA instead links to `/account/upgrade?callbackUrl=<current landlord URL>` directly (skipping signup since they already have an account; `/account/upgrade` is spec 022's route, referenced not built here) — button copy for that logged-in-but-free case may differ (e.g. "Upgrade to Premium"), builder's call, but the routing distinction (signed-out → `/signup?intent=premium`, signed-in-free → `/account/upgrade`) is required.
  - Output (edit): `web/app/favorites/page.tsx` (spec 021's file) — same paywall treatment, same two CTA branches, same styling as the landlord page's paywall card (shared visual language, not shared component code, to stay within file caps).
- **Design Pattern**: `requirePremiumTier()` is a strict superset of `verifySessionCookie()`'s pattern (cookie → cryptographic verify → derive UID → **+ one more deterministic step, a DB tier lookup** → only then authorize) — not a divergent new pattern, an extension of the existing one, matching this project's stated non-negotiable invariant ("a route must never trust a cookie's presence alone") one level further (a route must also never trust a verified-but-wrong-tier user for a premium-gated resource).
- **Bounded-AI boundary**: 100% deterministic. Tier check is a DB column read (`users.tier`). No LLM involvement anywhere in gating logic.
- **Verification Oracle**: `web/app/api/landlord/route.test.ts` (new or extended, mocked `verifySessionCookie()`/`pg` pool) asserts the three-way branch: (a) no/invalid cookie → `401`, no DB tier query executed; (b) valid cookie, mocked `tier: 'free'` → `403 { error: 'premium_required' }`, `getOrFetchLandlordProfile` never called; (c) valid cookie, mocked `tier: 'premium'` → existing profile-fetch behavior unchanged. Spec 019's `web/app/api/favorites/route.test.ts` gets the same three-way assertion added for `GET`/`POST`/`DELETE`. `web/e2e/features/landlord.spec.ts` or equivalent (new or extended) asserts the paywall card renders with the correct CTA link target and exact button text for a mocked free-tier/signed-out session on `/landlord`; same assertion added for `/favorites`. `npm run build`, `npm run type-check`, `npm run lint` all PASS.
- **Intellectual Control**: `requirePremiumTier()` being a literal extension of `verifySessionCookie()`'s already-proven pattern (rather than a new bespoke check) is what keeps this spec from reintroducing the Phase-12 auth-bypass class of bug at a new layer — the same discipline (verify cryptographically, derive identity from the verified result, never trust a client-asserted value) is just applied one field further (tier) instead of invented fresh.
- **Constraints**: `useAuth()`'s client-reported `tier` may be used for a fast, non-authoritative UI head-start (e.g., skipping a doomed API call) on both paywall pages, but the actual enforcement is always `requirePremiumTier()` inside the API route handler — a client that lies about its own tier must still be rejected server-side. This spec does not build any way for a user to actually become premium (no payment code) — it only defines and enforces what premium unlocks; spec 022 is the only place `users.tier` ever changes (via the unchanged webhook-as-source-of-truth pattern), and that remains true after this spec ships (a free user hitting either paywall simply cannot get past it yet in this spec's own scope, since `/account/upgrade` doesn't exist until spec 022 — see Edge Cases).
- **Edge Cases**: A signed-out user's CTA (`/signup?intent=premium`) points at spec 018's page, which exists independently of this spec — no dependency issue there. A signed-in-free user's CTA (`/account/upgrade`) points at a route that doesn't exist until spec 022 ships — if this spec is deployed before spec 022, that link 404s; this is spec 022's responsibility to resolve by existing before this reaches production use, not a defect in this spec's own code (same posture as spec 018's identical note about its own forward reference). `requirePremiumTier()` called for a `firebase_uid` with no matching `users` row (shouldn't happen for a real signed-in user, but defensively) → treated as `not-premium`/unauthorized, not a `500`. A premium user whose subscription lapses mid-session (webhook flips `tier` to `'free'` while they're viewing `/landlord`) → the next API call re-checks `requirePremiumTier()` fresh (no client-side caching of authorization across requests) and correctly denies, showing the paywall on next interaction rather than trusting a stale client-side "I'm premium" flag.
- **Files**: `web/lib/requirePremiumTier.ts` (new), `web/app/api/landlord/route.ts` (edit, includes its own test extension), `web/app/api/favorites/route.ts` (edit, spec 019's file), `web/app/landlord/page.tsx` (edit), `web/app/favorites/page.tsx` (edit, spec 021's file). 5 files, at cap. References: spec 019 (favorites API route this spec edits), spec 021 (favorites page this spec edits), spec 022 (the `/account/upgrade` target this spec's paywall links to but does not build). 3 references, at cap.

[FORCES]
1. **Handler-side tier verification > client-reported tier** — same severity class as spec 016 Force #5 (which itself echoed the Phase-12 fix): a client that lies about its own tier must still be rejected server-side, never trusted based on `useAuth()`'s response alone.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by extending `verifySessionCookie()`'s pattern into `requirePremiumTier()` rather than writing a standalone, differently-shaped tier check.
4. **Gating-only split, genuinely under the file cap > bundling with payment mechanism** — per the Split note above: "what premium unlocks" and "how a user becomes premium" are separable concerns; keeping them in separate specs means each stays under GRANULARITY's hard 5-file limit and each is independently reviewable.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- No `any` types — `requirePremiumTier()`'s return type is a discriminated union (`{ authorized: true, uid: string, email: string } | { authorized: false, reason: 'unauthenticated' | 'not-premium' }`), narrowed explicitly at each call site.
- Auth/tier checks server-side only (Hard Rule #4) — `useAuth()`'s client-reported `tier` is UI-convenience only, per Force #1 above; never the actual gate.

### Build Constraints
- `npm run build` must PASS.

### Test Constraints
- `web/app/api/landlord/route.test.ts` and spec 019's `web/app/api/favorites/route.test.ts` (extended) cover the three-way branch (unauthenticated/free/premium) per the Verification Oracle above, with mocked Firebase/pg — no live credentials required.
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- Playwright test(s) asserting the paywall card renders (correct CTA link target, correct text — including the exact required copy "Sign up for Landlord Profile" for the signed-out `/landlord` case) for a mocked free-tier/signed-out session on `/landlord` and `/favorites`.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- `requirePremiumTier()` — matches the human's own suggested name from the original requirements exactly.
- Paywall CTA button text: exactly **"Sign up for Landlord Profile"** for the signed-out `/landlord` case, per the human's explicit instruction — not paraphrased.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types.

### Security Constraints
- **`requirePremiumTier()` is mandatory and tested on both `/api/landlord` and `/api/favorites`** — no route serving premium-gated data may rely on client-side `useAuth()`-reported tier alone, per Force #1.
- `requirePremiumTier()` derives identity from the verified session cookie only, same as `verifySessionCookie()` — never accepts a client-supplied UID/tier claim.

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] requirePremiumTier: add DB-tier-lookup helper extending verifySessionCookie pattern`
  2. `[feat] api/landlord: gate behind requirePremiumTier, add paywall CTA to landlord page`
  3. `[feat] api/favorites: gate behind requirePremiumTier, add paywall CTA to favorites page`
  4. `[test] premium gating: add tier-branch coverage to landlord and favorites route tests, add paywall e2e coverage`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: three-way branch tests green on both routes; paywall-rendering e2e tests green.
