[SPEC]
- **Objective**: Add a Stripe-backed premium upgrade endpoint and tier gating on premium-only routes, completing Clash 4 (Auth/premium), building on Phase 11's `users.tier`/`stripe_customer_id` schema (`specs/014-firebase-auth-foundation.md`) and Phase 12's session/auth infrastructure (`specs/015-firebase-auth-middleware-ui.md`).
- **Human-approved scope note**: proceeds under the same 2026-08-12 human override recorded in Phase 11/12 — Firebase Auth + Stripe premium confirmed in scope now, overriding the `CLAUDE.md` team-table Phase-2 gate. Per the same routing rule, this spec should route through `soundwave` for architecture review before build, same as Phases 11-12.
- **Inputs/Outputs**:
  - Output: `web/lib/stripe.ts` — server-only Stripe SDK singleton (mirroring `pgClient.ts`/`firebaseAdmin.ts`'s established `getXxx()` pattern), wrapping `stripe.customers.create`/`stripe.subscriptions.create` (or Stripe Checkout Session creation, whichever this spec's builder confirms is simpler for a subscription flow — Stripe Checkout is the lower-integration-surface option and is the recommended default absent a specific reason to build a custom card form).
  - Output: `web/app/api/users/upgrade/route.ts` — `POST` route, **requires an authenticated session**: the handler itself must read Phase 12's HttpOnly session cookie and call `verifySessionCookie()` (`web/lib/firebaseAdmin.ts`) to cryptographically verify it, deriving the acting user's UID from the verified, decoded result — matching `web/app/api/auth/me/route.ts`'s existing pattern exactly (read cookie → `verifySessionCookie()` → derive UID → only then proceed; unverified/missing/invalid cookie → `401`, no Stripe call made). Middleware's presence-only cookie check (`web/middleware.ts`) may still redirect obviously-logged-out requests as a cheap first gate, but does not satisfy this requirement on its own and must not be relied on as the identity-verification step. Once the acting user's UID is verified, the route creates/retrieves a Stripe customer for that user's `firebase_uid`/`email`, initiates a subscription (or returns a Stripe Checkout Session URL for the client to redirect to — preferred, since it keeps raw card data off this app's servers entirely, consistent with PCI-scope minimization), and on confirmed payment (via Stripe webhook, not client-side trust) updates `users.tier = 'premium'`, `stripe_customer_id`, `subscription_expires`.
  - Output: `web/app/api/webhooks/stripe/route.ts` — `POST` route receiving Stripe webhook events (`checkout.session.completed` or `customer.subscription.updated`/`.deleted`), verifying the Stripe webhook signature (`STRIPE_WEBHOOK_SECRET`) before trusting any payload, and updating `users.tier`/`subscription_expires` accordingly — this is the actual source of truth for tier changes, not the `/upgrade` route's initial response, since payment confirmation is asynchronous.
  - New env vars: `STRIPE_SECRET_KEY` (server-only), `STRIPE_WEBHOOK_SECRET` (server-only, for webhook signature verification), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (client-exposed by Stripe's own design, needed only if a custom Stripe Elements form is used instead of Checkout — included for completeness even if the builder chooses the Checkout-redirect path, which doesn't strictly need it client-side).
- **Design Pattern**: Webhook-as-source-of-truth pattern for payment state — the `/upgrade` route initiates a payment flow but never itself flips `tier` to `'premium'` based on a client-trusted "payment succeeded" signal; only the signature-verified webhook does. This is a deliberate security pattern (never trust client-reported payment success), not a stylistic choice.
- **Bounded-AI boundary**: 100% deterministic. Tier assignment is driven entirely by Stripe's verified webhook events and direct Postgres writes — no LLM ever decides a user's tier or processes payment logic.
- **Verification Oracle**: A unit test (`web/app/api/webhooks/stripe/route.test.ts`) using Stripe's documented test-mode webhook signing (or a mocked signature-verification call) asserts: (a) a webhook payload with a valid signature and `checkout.session.completed` event type updates the corresponding user's `tier` to `'premium'` in Postgres; (b) a payload with an invalid/missing signature is rejected (`400`) and does NOT update any user row — this is the critical assertion, since a webhook route that trusts unsigned payloads is a direct path to free premium access. A companion unit test for `web/app/api/users/upgrade/route.ts` asserts: (c) a request with no session cookie, or a cookie that fails `verifySessionCookie()`, is rejected `401` and never calls the Stripe client — this is the assertion that proves the route enforces its own identity check rather than relying on middleware. An integration test against Stripe's test mode (documented in the PR, using Stripe's official test card numbers, not run in CI without Stripe test credentials) confirms the full `/upgrade` → Stripe Checkout → webhook → `tier='premium'` flow end to end.
- **Intellectual Control**: The signature-verification-is-mandatory assertion in the webhook test is what prevents the most serious possible bug in this spec — an attacker POSTing a fake "payment succeeded" event directly to the webhook route to get free premium access. Testing this explicitly (not just documenting it as a constraint) makes the protection provable, not just claimed. The `/upgrade` route's own `verifySessionCookie()` requirement (rather than relying on middleware) closes the specific gap this project already hit once, in Phase 12 (see Amendment note below): a route trusting cookie presence instead of cryptographic verification is a direct authentication bypass.
- **Constraints**: The `/upgrade` route itself must never write `tier = 'premium'` directly based on its own response — only the webhook handler does, after signature verification, per the Design Pattern above. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only env vars, never client-exposed, never logged. This spec depends on Phase 11's `users` table already having `stripe_customer_id`/`subscription_expires` columns (confirmed present, unpopulated, per that spec's Security Constraints note) and Phase 12's session infrastructure (`verifySessionCookie()`, `SESSION_COOKIE_NAME`) for determining which user is upgrading. `web/middleware.ts` is a presence-only cheap first gate by its own documented design (see its file comment) — it is explicitly NOT an acceptable substitute for the `/upgrade` handler's own `verifySessionCookie()` call.
- **Edge Cases**: Webhook received for a `firebase_uid`/Stripe customer that doesn't exist in `users` (shouldn't happen in normal flow, but defensively) → logged as an anomaly, not a silent failure, no row created speculatively. Duplicate webhook delivery (Stripe's documented at-least-once delivery guarantee) → the update must be idempotent (`UPDATE users SET tier = 'premium', ... WHERE firebase_uid = $1`, safe to run twice with the same result, not an `INSERT` that would fail on duplicate). Subscription cancellation/expiration webhook (`customer.subscription.deleted`) → `tier` reverts to `'free'`, not left stale at `'premium'`. `/upgrade` called with a missing, empty, expired, or tampered session cookie → `401`, no Stripe customer/session created, matching `/api/auth/me`'s existing `401` contract for the same failure modes.
- **Files**: `web/lib/stripe.ts` (new), `web/app/api/users/upgrade/route.ts` (new), `web/app/api/webhooks/stripe/route.ts` (new), `web/app/api/webhooks/stripe/route.test.ts` (new), `.env.example` (add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`). 5 files, at cap; a premium-gated feature route (e.g., landlord portfolio) is explicitly out of scope for this spec since landlord-portfolio search itself is deferred (per `wiki/context/plan.md`'s "Explicitly deferred" list, blocked on unresolved landlord-identity resolution) — this spec establishes tier-gating infrastructure only, with no premium feature yet to gate, flagged here rather than silently implying a feature that doesn't exist.

## Amendment note (2026-08-12, shockwave)

This spec is amended pre-build, in place, following a gap ratchet's Mode 1 review caught in the spec's own wording — no build has happened yet, so nothing built is being redone; this is a text-only tightening, same category of amendment as spec-013/014's process amendments but caught before rather than after the fact.

**What was wrong**: the original line 6 required the `/api/users/upgrade` route's caller identity be "verified via middleware or an explicit session check in the handler," offering these as equal alternatives. They are not equal. `web/middleware.ts` documents itself explicitly, in its own file comment, as a presence-only check — "This is a cheap first gate... NOT the actual security boundary. The real boundary is any route that serves data: it MUST call `verifySessionCookie()`." Phase 12 (see `specs/015-firebase-auth-middleware-ui.md` and `web/app/api/auth/me/route.ts`'s own Mode-2-correction comment) had a real authentication bypass vulnerability, since fixed, caused by exactly this class of gap: a route trusting cookie presence instead of cryptographic verification. Permitting "verified via middleware" as an alternative to an explicit handler-side check in a new spec risked reintroducing the same mistake in a route that will gate a paid feature.

**What changed**: line 6 (now the `/api/users/upgrade` bullet under Inputs/Outputs) is rewritten to mandate that the handler itself read the session cookie and call `verifySessionCookie()`, deriving the UID from the verified result before proceeding — reusing the exact pattern `web/app/api/auth/me/route.ts` already implements. "Verified via middleware" is removed as an alternative. Middleware may still redirect unauthenticated requests as a cheap first gate (unchanged, and still useful for UX), but is no longer described as satisfying the identity-verification requirement. The Verification Oracle, Intellectual Control, Constraints, and Edge Cases sections were each extended with a corresponding assertion/note so the requirement is provable in a test, not just stated in prose (mirroring how the original Design Pattern already made webhook-signature-verification provable rather than just claimed).

Re-entry: this amended spec re-enters at spec review (optimus-prime), not directly to wheeljack, per the standard re-entry process for an amended spec.

[FORCES]
1. **Webhook-verified payment state > client-trusted payment state** — this is the non-negotiable security property of this spec; every other design choice (Stripe Checkout over custom card forms, signature verification before any DB write) serves this one principle, since a payment/tier system that trusts client-reported success is trivially exploitable.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by using Stripe Checkout (redirect-based, less custom UI code) rather than a fully custom Stripe Elements payment form, which would be more "polished" but adds PCI-scope surface and custom-form complexity without a stated product requirement for a custom checkout experience; the simpler, safer, more teachable Checkout-redirect path is preferred.
4. **No premium feature to gate yet, infrastructure only > building a placeholder feature** — since landlord-portfolio search (the actual premium feature named in product-spec §3.2) is explicitly deferred pending unresolved landlord-identity resolution, this spec stops at "a user can become premium and the fact is recorded correctly," rather than inventing a placeholder gated feature just to demonstrate gating — that would be scope creep beyond what's actually needed right now.
5. **Explicit handler-side `verifySessionCookie()` > middleware-as-verification** — per the Amendment note above: middleware's presence-only check is a UX convenience, never a substitute for the cryptographic verification a route serving/gating paid functionality must perform itself. Non-negotiable, same severity class as force #1.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- `web/app/api/users/upgrade/route.ts` and `web/app/api/webhooks/stripe/route.ts` are server-only API routes.
- No inline secrets — `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from env vars only.
- No `any` types — Stripe SDK's own TypeScript types (`Stripe.Event`, `Stripe.Checkout.Session`, etc.) used explicitly.
- Auth checks on protected routes, never trust client-side checks (Hard Rule #4) — the `/upgrade` route requires a verified session (Phase 12) before initiating any Stripe flow; the webhook route requires a verified Stripe signature before trusting its payload — both are server-side, unbypassable checks. Per the Amendment note above, "verified session" for `/upgrade` specifically means an explicit, handler-side `verifySessionCookie()` call — middleware's presence-only redirect does not satisfy this constraint on its own.

### Build Constraints
- `npm run build` must PASS.
- No bundle-size impact from `stripe` (server SDK) — confirm it's never imported into a Client Component; if Stripe Checkout redirect is used (this spec's preferred approach per [FORCES] #3), no client-side Stripe.js is even required.

### Test Constraints
- `web/app/api/webhooks/stripe/route.test.ts`: signature-verification-mandatory tests per the Verification Oracle above (valid signature → tier updated; invalid/missing signature → rejected, no update).
- Companion unit test for `web/app/api/users/upgrade/route.ts` per the Verification Oracle above: missing/invalid session cookie → `401`, no Stripe client call made.
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- Full Stripe Checkout redirect flow is difficult to E2E test without real Stripe test-mode network calls; a Playwright test asserting the `/upgrade` route returns a valid Stripe Checkout URL (without completing the full payment flow, which requires Stripe's hosted UI) is an achievable E2E check — deferred to a follow-up if not completed in this spec's initial build, but not silently skipped without note.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- `getStripeClient()` singleton getter (matching `getPool()`/`getFirebaseAdmin()`'s established naming shape).
- Webhook route path `/api/webhooks/stripe` (not `/api/stripe-webhook` or similar) — matches the increasingly-standard `/api/webhooks/<provider>` convention and keeps room for future webhook providers under the same `webhooks/` namespace.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — Stripe SDK types used throughout; webhook payload typed via `Stripe.Event`, narrowed by `event.type` before access to type-specific fields.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after adding `stripe`.
- **Webhook signature verification is mandatory and tested** — the single most important security constraint in this spec, per [FORCES] #1.
- **`/api/users/upgrade` must call `verifySessionCookie()` directly in the handler** — mandatory and tested, per [FORCES] #5 and the Amendment note above; middleware's presence-only check is not an acceptable substitute.
- `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` never logged, never client-exposed.
- No sensitive card data ever touches this app's servers (Stripe Checkout handles PCI-scoped data entirely on Stripe's hosted page, per [FORCES] #3's design choice).

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] stripe: add server-only Stripe client singleton`
  2. `[feat] users/upgrade: add route creating Stripe Checkout session for authenticated user`
  3. `[feat] webhooks/stripe: add signature-verified webhook handler updating user tier`
  4. `[test] webhooks/stripe: add signature-verification-mandatory tests`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: webhook signature-verification tests green (both accept-valid and reject-invalid cases); `/upgrade` session-verification test green (missing/invalid cookie rejected, no Stripe call); Stripe test-mode integration flow documented in the PR.
