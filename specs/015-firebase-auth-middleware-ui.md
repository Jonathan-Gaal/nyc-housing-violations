[SPEC]
- **Objective**: Add Next.js middleware, a protected `/api/auth/me` route, and login/signup UI, building on Phase 11's token-verification foundation (`specs/014-firebase-auth-foundation.md`). **Correction to source-doc pattern (human-confirmed, apply this, not an open question)**: `context/product/open-violation-system-prompt.md`'s own §13.2/example fixture code stores the Firebase ID token in `localStorage` (`localStorage.setItem('firebaseAuthToken', token)`) — this directly violates this project's `nextjs-frontend` skill Hard Rule #6 ("HttpOnly cookies only. Never localStorage for tokens.") and Pattern 3 ("Store session tokens in HttpOnly cookies, never localStorage... vulnerable to XSS"). This spec implements the corrected pattern: the Firebase ID token is obtained client-side (Firebase Client SDK, required for the sign-in flow itself), sent once to a server route, verified server-side via Phase 11's `verifyIdToken`, and a session is established via an **HttpOnly, Secure, SameSite=strict cookie** set by the server — the raw Firebase ID token is never persisted in `localStorage`, `sessionStorage`, or any client-readable storage after that initial exchange.
- **Inputs/Outputs**:
  - Output: `web/app/api/auth/session/route.ts` — `POST` route: client sends the freshly-obtained Firebase ID token in the request body (over HTTPS, one-time use for session exchange, not stored), server calls `verifyIdToken` (Phase 11), upserts the `users` row (`ON CONFLICT (firebase_uid) DO UPDATE SET last_login = NOW()`, per Phase 11's anticipated upsert), and sets an HttpOnly session cookie (a server-signed session value or the verified-and-re-signed token, `httpOnly: true, secure: true, sameSite: 'strict', maxAge: <session length>`) — mirrors this project's skill's own documented `res.cookie(...)` example pattern.
  - Output: `web/middleware.ts` — Next.js middleware checking the HttpOnly session cookie (never a client-sent header) on any route matched by a `protectedPaths` matcher; missing/invalid cookie → redirect to `/login`, per the skill's own Pattern 8 example shape.
  - Output: `web/app/(auth)/login/page.tsx` — login page using the Firebase Client SDK (`NEXT_PUBLIC_FIREBASE_API_KEY` from Phase 11) for the actual sign-in UI (Google/email per product-spec §7.2), which on success calls `POST /api/auth/session` with the obtained ID token and then relies on the returned HttpOnly cookie for all subsequent requests — never reads or writes the token to `localStorage`.
  - Output: `web/hooks/useAuth.ts` — client hook exposing current-user state by calling `GET /api/auth/me` (reads the HttpOnly cookie server-side, returns `{ uid, email, tier }` or `null`), not by inspecting any client-stored token (the cookie is intentionally unreadable from JS).
- **Design Pattern**: Server-verified session cookie pattern — this project's skill's own Pattern 3 (HttpOnly cookies for auth), NOT the source doc's `localStorage` example. Middleware pattern for route protection — skill's own Pattern 8, adapted to check a cookie rather than an `Authorization` header (since the whole point of this correction is that the token is never client-readable to attach as a header in the first place).
- **Bounded-AI boundary**: 100% deterministic. Authentication state (is this user logged in, what's their tier) comes entirely from Firebase's cryptographic token verification (Phase 11) and a direct Postgres row read — no LLM involvement in any auth decision.
- **Verification Oracle**: A Playwright test (`web/e2e/features/auth.spec.ts`, building on Phase 8/9's infra) asserts: (a) an unauthenticated request to a protected route redirects to `/login`; (b) after completing sign-in via a test Firebase account, `document.cookie` does NOT contain a readable auth/session token (proving `httpOnly` is actually set — a JS-readable `document.cookie` check is precisely how this spec proves the correction was applied, not just claimed); (c) `localStorage.getItem('firebaseAuthToken')` (and any similarly-named key) is `null` after sign-in, directly disproving the source doc's pattern was accidentally followed; (d) `GET /api/auth/me` returns the signed-in user's profile after successful login. A unit test (`web/app/api/auth/session/route.test.ts`) asserts the `Set-Cookie` response header includes `HttpOnly`, `Secure`, and `SameSite=Strict` attributes.
- **Intellectual Control**: The Playwright assertion that explicitly checks `document.cookie` and `localStorage` for absence of the raw token is what makes this correction verifiable rather than just asserted in a spec's prose — a builder cannot silently regress to the source doc's `localStorage` pattern without failing this spec's own oracle. This is the strongest form of "correction, not open question" available: a failing browser-visible test if the wrong pattern is used.
- **Constraints**: The Firebase ID token itself is transmitted to `/api/auth/session` exactly once (at sign-in), over HTTPS, in the request body — never in a URL query string, never repeated on subsequent requests (subsequent requests rely on the HttpOnly cookie, which the browser attaches automatically). No client-side code anywhere in this spec reads `document.cookie` for the session value (defeating the purpose of `httpOnly`) — `useAuth.ts` gets auth state by calling the server (`/api/auth/me`), not by inspecting cookies client-side.
- **Edge Cases**: Session cookie expired/missing on a protected-route request → middleware redirects to `/login`, matching the skill's own Pattern 8 example. Firebase ID token verification fails during the `/api/auth/session` exchange (e.g., tampered token) → `401`, no cookie set, no `users` row upsert. `GET /api/auth/me` called with no cookie → `401` with `{ authenticated: false }` shape (not a 500), so `useAuth.ts` can distinguish "not logged in" from "server error."
- **Files**: `web/app/api/auth/session/route.ts` (new), `web/middleware.ts` (new), `web/app/(auth)/login/page.tsx` (new), `web/hooks/useAuth.ts` (new), `web/app/api/auth/me/route.ts` (new — reads the HttpOnly cookie, returns profile). 5 files, at cap; a signup-specific page (`web/app/(auth)/signup/page.tsx`) is deliberately excluded from this spec's file list to stay under the cap — Firebase's sign-in UI can reasonably serve both login and signup in a single form (Firebase Auth creates the account on first sign-in for email/Google flows), so a dedicated signup page is treated as an optional follow-up, not a hard requirement of this spec; flagged here rather than silently assumed.

[FORCES]
1. **Corrected, skill-compliant auth pattern > literal source-doc fidelity** — this is the single most consequential correction in the entire refactor plan: shipping the source doc's `localStorage` pattern verbatim would introduce a real XSS-exploitable vulnerability into a project whose own skill document explicitly forbids it as Hard Rule #6. This spec exists specifically to prevent that outcome, with a Playwright oracle that would catch a regression to the wrong pattern.
2. Simplicity > Pattern purity   (always present unless explicitly overridden)
3. OVERRIDE (project decision, 2026-08-05): Pattern purity > Simplicity for this project — applied by implementing the full skill-documented HttpOnly-cookie pattern (session exchange route, middleware, server-verified `/api/auth/me`) rather than a simpler-but-noncompliant shortcut, even though the corrected pattern requires more moving parts (an extra route, middleware config) than the source doc's simpler-but-wrong `localStorage` approach.
4. **Explicit soundwave-routing flag > silent proceed** — same as Phase 11 (`specs/014-firebase-auth-foundation.md`, [FORCES] #4): this spec should route through `soundwave` for architecture review before `wheeljack` builds it, per the project's standing team-table rule (timing gate lifted by human override, review requirement not lifted).

## Constraints

### Skill Constraints
Per `native_ai/.claude/skills/nextjs-frontend/SKILL.md`:
- **HttpOnly cookies only — never localStorage for tokens** (Hard Rule #6, Pattern 3) — this is the spec's central, explicitly-verified constraint, not a general reminder.
- Middleware for auth (Pattern 8) — `web/middleware.ts` checks the session cookie before protected handlers run, matching the skill's own documented shape.
- Server Components by default — `web/app/(auth)/login/page.tsx`'s static shell can be a Server Component; only the actual sign-in form (needing Firebase Client SDK interactivity) is a Client Component (`"use client"`), an explicit and justified exception.
- No `any` types — session/user payload shapes explicitly typed.
- No inline secrets — `NEXT_PUBLIC_FIREBASE_API_KEY` (client SDK, public by design per Firebase) and `FIREBASE_ADMIN_SDK_KEY` (server-only, from Phase 11) both remain env-var-sourced.

### Build Constraints
- `npm run build` must PASS.
- No bundle-size regression beyond what the Firebase Client SDK itself requires (a necessary cost of the sign-in UI, not avoidable within this spec's scope).

### Test Constraints
- `web/app/api/auth/session/route.test.ts`: asserts `Set-Cookie` header has `HttpOnly`, `Secure`, `SameSite=Strict` attributes.
- `npm test -- --run` GREEN on the full suite.

### E2E Test Constraints
- `web/e2e/features/auth.spec.ts`: the four Verification Oracle assertions above, run on all 4 configured browser projects (`npx playwright test e2e/features/auth.spec.ts`).
- Must be GREEN before this spec is considered complete — the `document.cookie`/`localStorage` absence checks are this spec's primary, non-negotiable oracle.

### Lint Constraints
- `npm run lint` must PASS (0 violations).

### Naming Constraints
- `useAuth` hook (not `useUser` or `useSession`) — matches the source doc's own naming (§ file tree, `hooks/useAuth.ts`), kept for consistency since this naming choice isn't part of what's being corrected.
- Session cookie name should be descriptive (e.g., `session` or `__session`, avoid anything implying it's the raw Firebase token, e.g. never name it `firebaseAuthToken` — that name is specifically what this spec's correction moves away from).

### Type Constraints
- `npm run type-check` must PASS (0 errors).
- No `any` types — `DecodedIdToken` (from Phase 11), session payload, and user-profile response shapes all explicitly typed.

### Security Constraints
- `npm audit` must PASS (0 vulnerabilities) after adding the Firebase Client SDK (`firebase`, already flagged for authorization in Phase 11's `.env.example`/dependency additions if not already added there — confirm `firebase` client package is present, add if Phase 11 only added `firebase-admin`).
- **HttpOnly, Secure, SameSite=Strict** on every auth cookie — verified by this spec's own test, not just asserted.
- CSRF: since this project uses cookie-based sessions, state-mutating routes (`/api/auth/session` POST) should be considered for CSRF protection per `native_ai/.claude/INDUSTRY-BEST-PRACTICES.md` §5's CSRF guidance — `SameSite=Strict` on the session cookie itself provides meaningful CSRF mitigation for this spec's scope; a dedicated CSRF-token scheme is not required here but flagged as a future hardening item if state-mutating premium-tier routes (Phase 13) need stronger protection.

### Commit Constraints
- Recommended commit sequence:
  1. `[feat] auth: add /api/auth/session route (verify token, set HttpOnly cookie, upsert user)`
  2. `[feat] auth: add middleware for protected-route cookie check`
  3. `[feat] auth: add /api/auth/me route and useAuth hook`
  4. `[feat] auth: add login page with Firebase Client SDK sign-in`
  5. `[test] auth: add e2e spec verifying HttpOnly cookie and no localStorage token`
- All tests GREEN before each commit.

### Pre-Push Constraints
- All tests GREEN: `npm run build`, `npm test -- --run`, `npm run lint`, `npm run type-check`, `npm audit`, `npx playwright test e2e/features/auth.spec.ts`.
- Git status clean: `git status --porcelain` empty.
- Verification Oracle passes: all four Playwright assertions green, including the explicit `document.cookie`/`localStorage` absence checks that prove the source-doc's `localStorage` pattern was NOT used.
