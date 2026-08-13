[SPEC]
- **Objective**: Add the `users` table to Postgres and wire up the Firebase Admin SDK server-side, as the foundation for Phase 12's protected routes. Auth is Firebase only — Supabase remains DB-only in this stack (per the 2026-08-12 locked decision). This spec creates schema and SDK plumbing only; no middleware, no protected routes, no UI (that's Phase 12, `specs/015-firebase-auth-middleware-ui.md`).
- **Human-approved scope note**: this phase builds on the human's explicit 2026-08-12 confirmation that Firebase Auth + Stripe premium is in scope now, overriding project `CLAUDE.md`'s team-table line gating auth work behind `soundwave`/"Phase 2, not Week 1 MVP." That line is not edited — this spec proceeds under the override, recorded in `wiki/context/plan.md`. Per the team table's own routing rule, `soundwave` remains the correct reviewer for this spec's architecture before it's built (the override lifts timing, not the review requirement) — flagged here for the human/orchestrator to route accordingly, not silently skipped.
- **Inputs/Outputs**:
  - Output: `web/db/migrations/002_users.sql` — a new plain numbered SQL migration (per locked decision #4, continuing Phase 1's migration approach) creating a `users` table: `firebase_uid TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_customer_id TEXT, subscription_expires TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login TIMESTAMPTZ`, per product-spec §5.1's `users` table shape.
  - Output: `web/lib/firebaseAdmin.ts` — server-only Firebase Admin SDK initialization (singleton pattern, matching `web/lib/pgClient.ts`'s established `getPool()` shape from Phase 1), exporting `verifyIdToken(token: string): Promise<DecodedIdToken>` for server-side token verification. **No client-side Firebase SDK code in this spec** — that's Phase 12's concern (login/signup UI), kept separate so this spec's file scope stays schema+admin-SDK only.
  - New env vars: `FIREBASE_ADMIN_SDK_KEY` (server-only, the service account JSON or its path/credentials, never client-exposed) and `NEXT_PUBLIC_FIREBASE_API_KEY` (client-exposed by Firebase's own design, documented here even though the client SDK itself isn't wired up until Phase 12, so the env var contract is established once).
- **Design Pattern**: Singleton initialization pattern for `firebaseAdmin.ts`, mirroring `pgClient.ts`'s `getPool()` — consistent with this project's Pattern-purity override (reuse an established in-codebase pattern rather than introduce a new initialization style for a similar "lazy singleton, server-only resource" need).
- **Bounded-AI boundary**: 100% deterministic. Token verification is Firebase Admin SDK's own cryptographic signature check (`verifyIdToken`), not an LLM decision. No LLM ever determines whether a user is authenticated or what their tier is — both come from cryptographically verified token claims and a direct Postgres row lookup.
- **Verification Oracle**: A unit test (`web/lib/firebaseAdmin.test.ts`) using the Firebase Admin SDK's documented emulator/testing pattern (or a mocked `admin.auth()` if the emulator isn't available in this environment) asserts: (a) `verifyIdToken` with a validly-signed test token returns the expected decoded claims; (b) `verifyIdToken` with a malformed/expired/invalid-signature token rejects (throws), never silently returning a falsy-but-truthy "unauthenticated" object that a caller might mishandle. A migration-runner check (reusing Phase 1's `web/scripts/migrate.ts`) confirms `002_users.sql` applies cleanly and idempotently against the real Supabase instance, creating the `users` table with the documented schema.
- **Intellectual Control**: Splitting "can we verify a token and does the users table exist" (this spec) from "does the app actually gate routes and show login UI" (Phase 12) means a failure in token-verification logic is isolated and testable before any user-facing auth flow depends on it — the same staged-de-risking discipline applied throughout this refactor (e.g., Phase 1/2's SQLite-vs-Postgres regression split).
- **Constraints**: `FIREBASE_ADMIN_SDK_KEY` must never be logged, and must be loaded exclusively server-side (this file is never imported by a Client Component — enforce via not exporting anything from a file with `"use client"`, and by keeping this module out of any component's import graph in this spec, since no UI exists yet to accidentally import it). New migration file numbering continues Phase 1's sequence (`002_users.sql` following `001_init.sql`) — `web/scripts/migrate.ts`'s existing ambiguous-prefix guard (Phase 1's Edge Cases) already protects against a numbering collision. **Amended 2026-08-12:** `web/package.json` carries a top-level `overrides` block pinning `uuid` to `^11.1.1` — see amendment note below.
- **Edge Cases**: `FIREBASE_ADMIN_SDK_KEY` missing at startup → `firebaseAdmin.ts`'s singleton getter throws a clear error before any verification attempt (fail fast, matching `pgClient.ts`'s established `DATABASE_URL`-missing behavior from Phase 1 for consistency). A user's Firebase UID already exists in `users` on a repeat login → `INSERT ... ON CONFLICT (firebase_uid) DO UPDATE SET last_login = NOW()` (upsert), not a duplicate-row error — this spec's migration/schema anticipates this even though the actual login-flow code that performs the upsert is Phase 12's responsibility.
- **Files**: `web/db/migrations/002_users.sql` (new), `web/lib/firebaseAdmin.ts` (new), `web/lib/firebaseAdmin.test.ts` (new), `web/package.json` (add `firebase-admin` to `dependencies` — it is a server runtime dependency, not a devDependency; **amended 2026-08-12:** also carries the `overrides.uuid` pin, see below), `.env.example` (add `FIREBASE_ADMIN_SDK_KEY`, `NEXT_PUBLIC_FIREBASE_API_KEY`). 5 files, at cap.

[FORCES]
1. **Schema-and-verification-first > UI-first** — proving the server can create the `users` table and correctly verify/reject tokens before any login button exists means Phase 12's UI work has a solid, already-tested foundation to call into, rather than discovering token-verification bugs while also debugging a new login form.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by mirroring `pgClient.ts`'s singleton-getter pattern for `firebaseAdmin.ts` rather than a different initialization style, and by using product-spec §5.1's exact `users` schema rather than a simplified version, for consistency with both the codebase's existing patterns and the target-state doc.
4. **Explicit soundwave-routing flag > silent proceed** — per this project's `CLAUDE.md` team-table routing rule (auth work routes through `soundwave` for architecture review), this spec is written but should be routed to `soundwave` before `wheeljack` builds it, even though the *timing* gate (Phase 2 vs. now) has been explicitly lifted by the human. This is noted as a build-order flag for the orchestrator, not something this spec can self-authorize.
5. **Amended 2026-08-12: A correct, narrowly-scoped security fix, retroactively authorized > redoing the fix a different way** — `uuid@^11.1.1` via `overrides` resolves a real transitive vulnerability (GHSA-w5hq-g745-h8pq) tree-wide to a version `uuid`'s own maintainers publish, touches no other package, and adds no new capability. Waiting for `@google-cloud/storage`/`firebase-admin` to bump their own `uuid` range naturally was considered and rejected as the redo path — there is no published timeline for that upstream bump, and the override is trivially removable once it happens (delete one `overrides` entry, re-run `npm install`, confirm the tree still resolves to a non-vulnerable `uuid`). The security fix itself is not being redone. The **process** that produced it is the part being corrected — see Amendment note below.

## Amendment note (2026-08-12, shockwave)

This spec is amended retroactively, after the fact, to formally authorize a dependency change wheeljack made without filing the required `[DEPENDENCY-REQUEST]` first. This is a different situation from spec-013's `@vitest/coverage-v8` amendment (that one was requested and approved *before* the dependency was added); this one is sign-off *after* wheeljack already added it and shipped the commit. Recorded here for both reasons: to authorize the change and to put the process gap on record.

**What happened**: while building this spec, `firebase-admin@14.2.0` pulled `@google-cloud/storage@7.22.0`, which transitively depends on `gaxios` and `google-gax` — both of which declare old `uuid` ranges (`^9.0.1` / `^9.0.0`) that resolve to a version affected by GHSA-w5hq-g745-h8pq. Instead of halting and filing a `[DEPENDENCY-REQUEST]` for shockwave to rule on, wheeljack added an `overrides` block to `web/package.json`:
```json
"overrides": {
  "uuid": "^11.1.1"
}
```
and proceeded to commit (`825552b`). Ratchet's Mode 2 review caught this during compliance verification. Ratchet confirmed the fix works (`npm ls uuid` resolves a single `uuid@11.1.1` tree-wide; `npm audit` reports 0 vulnerabilities) but correctly ruled that adding an `overrides` entry is itself a build-affecting, tree-wide dependency decision — the same category of decision DEPENDENCY AUTHORITY exists to gate — regardless of whether the package being overridden is "new" or was already transitively present. Ratchet did not unwind the commit (correct call: the fix is sound, reverting it would just reintroduce the vulnerability) and flagged it for shockwave sign-off instead of closing it silently.

**Independent re-verification (shockwave, 2026-08-12)**: confirmed via `web/package-lock.json` directly rather than taking the audit report on faith alone — a single `node_modules/uuid` entry resolves to `version: 11.1.1` from the real npm registry (not a fork), and the two declared dependents pulling old `uuid` ranges (`gaxios@6.7.1` → `uuid@^9.0.1`, `google-gax` → `uuid@^9.0.0`) are both several layers below `firebase-admin` → `@google-cloud/storage` and both marked `optional: true` in the lockfile. No new top-level package was introduced; the override touches exactly one key (`uuid`) and no other package.

**Approved retroactively**: `overrides: { "uuid": "^11.1.1" }` in `web/package.json` is authorized as a narrowly-scoped security fix — constrains an already-present transitive dependency to a non-vulnerable version its own maintainers publish, adds no new capability, touches no package other than `uuid`. The commit (`825552b`) stands; it is not being reverted or redone. See Constraints and Files above for the corresponding markers.

**Process gap, on record**: wheeljack should have halted at the point the vulnerable transitive `uuid` was discovered and filed a `[DEPENDENCY-REQUEST]` for shockwave to rule on *before* adding the override and proceeding — the same sequence spec-013's `@vitest/coverage-v8` gap followed correctly. "The package was already transitively present, not a brand-new top-level install" is not an exemption from DEPENDENCY AUTHORITY; an `overrides` entry is a tree-wide, build-affecting decision regardless of why the underlying package was already in the graph. This is noted here as a correction to process, not as grounds to unwind a fix that is otherwise sound — ratchet's decision not to revert stands.

Per re-entry process: this amended spec re-enters at spec review (optimus-prime) for confirmation the amendment itself is well-formed, not back to wheeljack — no new build work results from this amendment.

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- `firebaseAdmin.ts` is server-only — never imported into a Client Component, never bundled to the browser (enforced by the fact that no Client Component exists yet to import it, in this spec's scope).
- No inline secrets — `FIREBASE_ADMIN_SDK_KEY` from env var only.
- No `any` types — Firebase Admin SDK's own `DecodedIdToken` type used for the verification return type.
- Not applicable this spec: HttpOnly cookies (Phase 12's concern), Zod (no external HTTP input parsed in this spec — schema/SDK setup only).

### Build Constraints
- `npm run build` must PASS.
- No bundle-size impact — `firebase-admin` is server-only, never bundled client-side (confirm this explicitly, since `firebase-admin` is a notably large package and an accidental client import would be a meaningful regression).

### Test Constraints
- `web/lib/firebaseAdmin.test.ts`: covers valid-token acceptance and invalid/expired/malformed-token rejection, per the Verification Oracle above.
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- Not applicable to this spec — no UI exists yet to E2E test. Phase 12 (`specs/015-firebase-auth-middleware-ui.md`) will add the corresponding Playwright auth-flow spec.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- `verifyIdToken` (not `verify` or `checkToken`) — matches Firebase Admin SDK's own naming convention directly, minimizing confusion for future maintainers reading Firebase's docs alongside this code.
- `getFirebaseAdmin()` singleton getter, mirroring `getPool()`'s naming shape from Phase 1.

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — `DecodedIdToken` and other Firebase Admin SDK types used explicitly throughout.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after adding `firebase-admin`. **Amended 2026-08-12:** this required the `overrides.uuid` pin documented above (GHSA-w5hq-g745-h8pq) — `npm audit` is confirmed clean with the override in place; do not remove the override without re-verifying `npm audit` stays clean.
- `FIREBASE_ADMIN_SDK_KEY` never logged, never committed — `.env.example` documents the expected shape (service account JSON path or inline credentials, per Firebase's documented options) with a placeholder only.
- `users` table's `stripe_customer_id`/`subscription_expires` columns exist now (per product-spec §5.1's combined schema) but are not populated or read by any code until Phase 13 (`specs/016-stripe-premium-tier.md`) — flagged so a reviewer doesn't expect Stripe logic in this spec.

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] db: add users table migration (002_users.sql)`
  2. `[feat] firebaseAdmin: add server-only Admin SDK singleton with verifyIdToken`
  3. `[test] firebaseAdmin: add token verification tests`
- All tests GREEN before each commit.
- **Amended 2026-08-12:** the `overrides.uuid` change was committed as part of the existing `825552b` commit rather than as a separate `[fix] deps:` commit (spec-013's `@vitest/coverage-v8` amendment used a dedicated commit for comparison) — not being unwound retroactively since the commit already shipped; noted for the record, not actionable.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: token verification tests green; `002_users.sql` applies cleanly and idempotently against the real Supabase instance.
