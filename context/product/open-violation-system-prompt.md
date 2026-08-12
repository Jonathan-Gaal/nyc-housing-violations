# Open Violation System Prompt
## Professional Next.js 14 + React + Firebase + Live API Architecture

---

## Project Context

**Open Violation** is a NYC rental research platform that helps budget-conscious renters identify buildings where landlords demonstrably resolve tenant complaints. The core insight: **violation count alone is a weak signal—landlord responsiveness is what matters**.

**Core User Journey**: Enter a zip code → See buildings ranked by composite landlord responsiveness score → (Premium) Explore landlord's full property portfolio and violation patterns.

**Data Model**: Live NYC HPD Open Data API (Socrata v3) + PostgreSQL denormalization for fast queries + Firebase Auth for user identity.

---

## Architecture Principles

### 1. Data Integrity & API Consistency

- **Single Source of Truth**: The NYC HPD Socrata v3 API is authoritative. Cache strategically but always validate freshness.
- **Violation Status Filter Is Immutable**: The `OPEN` filter on violation status is hardcoded in all data fetch functions—never a caller parameter. Signature: `fetchOpenViolations(zip: string)`.
- **Address Range Logic**: `LowHouseNumber` and `HighHouseNumber` are NYC block-lot text format strings, not integers. Buildings spanning multiple entrances/wings aggregate under one `BuildingID` (BIN).
- **Composite Scoring Algorithm** (Six factors, total 100%):
  - Total violations: 25%
  - Rent-impairing violations: 25%
  - Average years stuck open: 20%
  - Percent in dead-end statuses (NOV SENT OUT, NOT COMPLIED WITH, NO ACCESS): 15%
  - Percent reissued violations: 15%
  - Recurring same-issue factor: TBD (exploratory)
  - **Response must always include `scoringBreakdown`** with unscaled component values for frontend transparency.
  - **Sort order**: Ascending (worst-scoring buildings first).

### 2. TypeScript & Type Safety

- **Strict mode enabled**. All API responses, database rows, and component props are explicitly typed.
- **Discriminated unions** for error handling and state variants (not error flags + data).
- **Nominal types** for domain concepts (BuildingID, Zip, ViolationID, etc.) to prevent accidental type confusion:
  ```typescript
  type BuildingID = Brand<string, 'BuildingID'>;
  type Zip = Brand<string, 'Zip'>;
  ```
- **Exhaustiveness checks** in switch statements and type guards.
- **No `any` or `unknown` without documented justification.**

### 3. Minimal Dependencies

- Prefer in-house implementations for validation, rate limiting, caching, and CSS over third-party libraries.
- Current stack: React, Next.js, TypeScript, PostgreSQL (`pg` driver), Firebase Admin SDK, Mapbox GL, Chart.js (visualization only), Tailwind CSS.
- **No ORM**—raw `pg` driver for fine-grained control and performance.
- **No external validation library**—write custom validators for domain logic (zip code format, violation status enums, scoring bounds).

### 4. Component & State Architecture

- **Server Components by default** in Next.js 14—only use Client Components (`'use client'`) for interactivity.
- **RSC + Server Actions** for data mutations (Firebase Auth context remains client-side for real-time auth state).
- **Minimal client state**: Use React Query / SWR for async server data fetching, local component state for UI-only state (dropdown open/close, form input). Redux is not needed.
- **Composition over configuration**: Favor small, focused components with clear props over complex, configurable mega-components.

### 5. API Design & Error Handling

#### HTTP API Routes (`/app/api/...`)

- **Consistent response shape**:
  ```typescript
  type ApiResponse<T> = 
    | { ok: true; data: T }
    | { ok: false; error: ApiError };

  type ApiError = {
    code: string; // Machine-readable: 'INVALID_ZIP', 'RATE_LIMIT_EXCEEDED', 'AUTH_REQUIRED'
    message: string; // User-facing description
    statusCode: number; // HTTP status
    details?: Record<string, unknown>; // Optional: scoring breakdown, validation errors, etc.
  };
  ```
- **Status codes**: 200 (OK), 400 (validation), 401 (auth), 403 (forbidden), 429 (rate limit), 500 (server error).
- **All API routes require authentication** unless explicitly public (e.g., `/api/public/buildings/{zip}`).
- **Input validation happens first**: Validate zip, query bounds, user tier before touching database or external APIs.
- **Rate limiting**: Implement in-memory token bucket per user ID (Firebase UID) or IP (for public endpoints). Suggested: 60 requests/minute per user.
- **No sensitive data in error messages**—log full details server-side, return sanitized messages to client.

#### External API Integration (NYC HPD Socrata)

- **Connection pooling**: Use `pg` with `Pool` for concurrent queries; configure pool size (default 10, tune based on deployment).
- **Timeouts**: Set aggressive timeouts (5s for Socrata API calls, 30s for database queries). Fail fast.
- **Retry logic**: Implement exponential backoff (max 3 retries) for transient failures (5xx, timeout). Don't retry 4xx errors.
- **Caching strategy**:
  - Database: Denormalize building scores nightly via batch job; refresh on user-triggered audit (premium feature).
  - HTTP cache: Use `Cache-Control: max-age=3600` for `/api/buildings/{zip}` to reduce API pressure.
  - Client cache: React Query with `staleTime: 5 * 60 * 1000` (5 minutes) for zip search results.
- **Data validation**: Validate Socrata response shape before inserting into database. Log schema mismatches.

### 6. Security & Auth

- **Firebase Auth is single source of truth** for user identity; all API routes validate Firebase tokens server-side.
- **Middleware validation**: Implement Next.js middleware to enforce auth on protected routes before hitting handlers.
  ```typescript
  // middleware.ts
  export function middleware(request: NextRequest) {
    const token = request.headers.get('authorization')?.split(' ')[1];
    if (!token && isProtectedPath(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }
  ```
- **CORS**: Configure explicitly; only allow `https://open-violation.vercel.app` (or staging domain) in production.
- **Environment secrets**: Never hardcode API keys, database URLs, or Firebase credentials. Use `.env.local` in development; Vercel/Railway secrets in production.
- **Row-level security (future)**: When multi-tenant data arrives, enforce tenant isolation at the database query level.
- **No client-side secrets**: Firebase Client SDK is public by design (API key visible in browser). Sensitive operations (admin batch jobs, landlord portfolio queries) happen server-side only.

### 7. Database (PostgreSQL)

- **Schema design**:
  - `buildings` table: `(bin: TEXT PRIMARY KEY, address: TEXT, zip: TEXT, landlord_id: TEXT, score: FLOAT, score_breakdown: JSONB)`.
  - `violations` table: `(violation_id: TEXT PRIMARY KEY, bin: TEXT, status: TEXT, opened_date: DATE, closed_date: DATE, category: TEXT, is_rent_impairing: BOOL)`.
  - `users` table: `(firebase_uid: TEXT PRIMARY KEY, email: TEXT, tier: TEXT, created_at: TIMESTAMP)` (for freemium tracking).
- **Indexing**: Index `(zip, score)` for fast zip-based ranking; index `(firebase_uid, created_at)` for user queries.
- **No N+1 queries**: Batch violations fetch per zip; use `LEFT JOIN` or aggregation in SQL, never loop-in-application.
- **Data freshness**: Socrata sync runs nightly (async job); violations added since last sync are ~12 hours stale (acceptable for this product).

### 8. Frontend Patterns

#### Pages & Routing

- **App Router** (Next.js 14): Nested folder structure maps to URL routes; `layout.tsx` for shared UI.
- **Dynamic routes**: `[zip]` for zip-based pages; use `generateStaticParams()` for ISR where feasible (NYC has 200 zip codes—precompute builds).
- **Not-found & error boundaries**: Implement `not-found.tsx` and `error.tsx` for graceful degradation.

#### Forms & User Input

- **Controlled inputs** for zip search; validate as user types (debounce 300ms for zip format checks, not API calls).
- **No external form library** unless complexity demands it. React `useState` + `useCallback` suffice.
- **Accessibility**: All form inputs have `label`, `aria-label`, or `aria-labelledby`. Test with keyboard navigation.
- **Progressive enhancement**: Form works with JS disabled (basic server-rendered validation).

#### Data Fetching & Async State

- **React Query** (`@tanstack/react-query`) for client-side caching and sync with server state.
  ```typescript
  const { data, isLoading, error } = useQuery({
    queryKey: ['buildings', zip],
    queryFn: () => fetch(`/api/buildings/${zip}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  ```
- **Suspense + streaming** (where beneficial): Use `<Suspense>` + Server Components to stream UI progressively; skeleton loaders for fast feedback.
- **No overfetching**: Break large datasets into pagination or infinite scroll; start with top 20 buildings per zip.

#### Visualization & Charts

- **Chart.js** for responsive charts (violation timelines, scoring breakdown).
- **Mapbox GL** for heatmaps (density of open violations by neighborhood).
- **Canvas-based rendering is acceptable but mobile-optimized**: Test on iPhone; ensure touch interactions work.
- **No 3D / WebGL unless justified**—keep performance budget under 100ms first paint on 3G.

### 9. Performance & Optimization

- **Core Web Vitals**: Target LCP < 2.5s, CLS < 0.1, FID < 100ms (or INP < 200ms).
- **Image optimization**: Use `next/image` with responsive sizes; lazy-load off-screen charts and maps.
- **Code splitting**: Dynamic imports for heavy libraries (Mapbox GL, Chart.js). Route-based code splitting built-in to Next.js.
- **Database query optimization**:
  - Use `EXPLAIN ANALYZE` for slow queries; add indexes before adding caching.
  - Batch API calls (fetch violations for 10 buildings in one query, not 10 separate queries).
- **API response size**: Limit initial `/api/buildings/{zip}` payload to < 500 KB (top 50 buildings, essential fields only). Paginate violation details on demand.
- **Caching tiers**:
  1. Database (PostgreSQL query results, indexed).
  2. HTTP cache (3600s for `/api/buildings/{zip}`).
  3. Client cache (React Query, 5 min stale time).
  4. Browser cache (images, static assets).

### 10. Testing & Quality

- **Unit tests** (`vitest`) for business logic: scoring algorithm, validation functions, date parsing.
  ```typescript
  describe('scoringEngine', () => {
    it('should rank worst-responsive landlords first', () => {
      const result = scoreBuilding({...});
      expect(result.score).toBeLessThan(50); // Example assertion
    });
  });
  ```
- **Integration tests** for API routes: mock Firebase Auth, test request → response.
- **E2E tests** (Playwright or Cypress): zip search → results → click building → details page. Test on staging.
- **Accessibility testing**: Use axe-core; test keyboard navigation, screen reader compatibility.
- **No tests are needed for**: trivial components (buttons with no logic), third-party integrations (Firebase library itself), or visual regressions (unless design-critical).

### 11. Error Handling & Logging

- **Errors are values, not exceptions**: Use `Result<T, E>` pattern for recoverable errors (validation, network).
- **Exceptions for unrecoverable conditions** (out of memory, corrupted database). Catch only if you can recover.
- **Structured logging**:
  ```typescript
  logger.info('Building score computed', {
    bin: '1234567',
    zip: '10001',
    score: 68,
    timestamp: new Date().toISOString(),
  });
  logger.error('Socrata API error', {
    statusCode: 503,
    retryCount: 2,
    zip: '10001',
  });
  ```
- **Sentry integration** (production): Capture exceptions, performance metrics, and user sessions. Do not log sensitive user data.
- **Client-side error boundaries**: Catch React component errors; display fallback UI; log to Sentry.

### 12. Deployment & DevOps

- **Vercel** for frontend (Next.js); **Railway** for backend (PostgreSQL, async jobs).
- **Environment parity**: Dev / staging / production configs are identical except for secrets and log levels.
- **Database migrations**: Use a migration tool (`pg-migrate` or `knex` with raw SQL). Version control all migrations.
- **Rollout strategy**: Blue-green deployments for zero-downtime updates. Feature flags for partial rollouts (new scoring algorithm, etc.).
- **Monitoring**: Track 404/500 rates, API response times, database query times, auth failures. Alert on anomalies.
- **Secrets rotation**: Rotate Firebase service account keys and database passwords every 90 days.

---

## File & Folder Structure

```
web/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   ├── signup/
│   │   └── layout.tsx
│   ├── (app)/
│   │   ├── page.tsx                 # Home
│   │   ├── [zip]/
│   │   │   ├── page.tsx             # Zip search results
│   │   │   └── [bin]/
│   │   │       └── page.tsx         # Building detail
│   │   ├── landlord/
│   │   │   └── [landlordId]/
│   │   │       └── page.tsx         # Landlord profile (premium)
│   │   └── layout.tsx               # App layout with nav
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...nextauth].ts     # (if using NextAuth; Firebase is native)
│   │   ├── buildings/
│   │   │   ├── [zip]/
│   │   │   │   └── route.ts         # GET /api/buildings/[zip]
│   │   │   └── [zip]/[bin]/
│   │   │       └── route.ts         # GET /api/buildings/[zip]/[bin]
│   │   ├── violations/
│   │   │   └── [bin]/
│   │   │       └── route.ts         # GET /api/violations/[bin]
│   │   ├── landlord/
│   │   │   └── [landlordId]/
│   │   │       └── route.ts         # GET (premium)
│   │   └── health/
│   │       └── route.ts             # GET /api/health (liveness)
│   ├── layout.tsx                   # Root layout
│   └── globals.css
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   └── ...
│   ├── ZipSearch.tsx                # Client component
│   ├── BuildingCard.tsx
│   ├── BuildingList.tsx
│   ├── ViolationTimeline.tsx        # Chart.js integration
│   ├── HeatmapViewer.tsx            # Mapbox GL integration
│   └── ErrorBoundary.tsx
├── lib/
│   ├── api.ts                       # Socrata client, batching logic
│   ├── db.ts                        # PostgreSQL pool, queries
│   ├── auth.ts                      # Firebase Admin SDK setup
│   ├── scoring.ts                   # Composite scoring algorithm
│   ├── validation.ts                # Zip, BIN, violation status validators
│   ├── cache.ts                     # In-memory rate limiting, cache helpers
│   ├── logger.ts                    # Structured logging
│   └── types.ts                     # All TypeScript definitions
├── hooks/
│   ├── useZipSearch.ts              # Custom hook for zip search
│   ├── useBuilding.ts               # Custom hook for building detail
│   └── useAuth.ts                   # Firebase auth state
├── public/
│   ├── images/
│   └── ...
├── .env.local                       # Development secrets (gitignored)
├── .env.example                     # Template (checked in)
├── next.config.js
├── tsconfig.json
├── tailwind.config.ts
├── vitest.config.ts
└── package.json
```

---

## Development Workflow

### 13.1 Test-Driven Development (TDD) Discipline

**Core principle**: Write test first, implement second, commit third.

```
1. RED    → Write E2E/unit test (fails, feature doesn't exist)
2. GREEN  → Implement feature until test passes
3. REFACTOR → Optional: clean up without changing behavior
4. COMMIT → One atomic feature = one commit
5. VERIFY → Pre-commit hooks (lint, type-check, tests)
6. PUSH   → Pre-push hooks (build, coverage, E2E across browsers)
```

**Never commit code that doesn't pass tests.** Pre-commit hooks enforce this.

---

### 13.2 Local Setup

```bash
cd web
npm install

# Copy env template
cp .env.example .env.local

# Populate:
# - NEXT_PUBLIC_FIREBASE_API_KEY
# - FIREBASE_ADMIN_SDK_KEY
# - DATABASE_URL (Postgres local)
# - SOCRATA_API_TOKEN (optional, for live API)

# Start Postgres locally
docker run -d \
  -e POSTGRES_PASSWORD=local \
  -p 5432:5432 \
  postgres:15

# Run migrations
npm run migrate:local

# Install Playwright browsers
npx playwright install

# Start dev server + watch tests
npm run dev &
npm run test:watch &
npm run e2e:ui &

# Open http://localhost:3000
```

---

### 13.3 Feature Branch Workflow (Test-First)

**Branch naming**: `feat/<feature>`, `fix/<bug>`, `refactor/<area>`

**Example: "Implement zip code validation"**

```bash
# 1. Create branch
git checkout -b feat/zip-validation

# 2. Write E2E test (RED)
# File: e2e/features/zip-search.spec.ts
test('should validate zip format (must be 5 digits)', async ({ page }) => {
  await page.goto('/');
  const zipInput = page.getByLabel('Enter zip code');
  await zipInput.fill('ABC');
  await page.getByRole('button', { name: 'Search' }).click();
  
  const error = page.getByText('Zip code must be exactly 5 digits');
  await expect(error).toBeVisible();
});

# Run test (fails)
npm run e2e -- --grep "validate zip format"
# ❌ FAILED: Element not found

# 3. Implement feature (GREEN)
# File: app/(app)/page.tsx
# Add zip validation logic

# Run test (passes)
npm run e2e -- --grep "validate zip format"
# ✅ PASSED

# 4. Run full local test suite
npm run test:pre-commit
# ✅ Lint
# ✅ Type check
# ✅ Unit tests

# 5. Commit (one logical chunk)
git add -A
git commit -m "feat: add zip code input with format validation

- Validate zip must be exactly 5 digits
- Show error message for invalid input
- Disable search button until valid

Fixes #42 (if in Jira/GitHub)
Test: e2e/features/zip-search.spec.ts#validate-zip-format"

# Husky pre-commit hooks run automatically:
# ✅ ESLint + Prettier
# ✅ TypeScript type check
# ✅ Unit tests pass
# → Commit created

# 6. Before pushing, verify pre-push checks locally
npm run test:pre-push
# ✅ Build succeeds
# ✅ Test coverage passes
# ✅ E2E tests pass (Chromium, Firefox, WebKit, Mobile)

# 7. Push
git push origin feat/zip-validation

# Husky pre-push hooks run automatically:
# ✅ Build succeeds
# ✅ Full test suite passes
# → Push succeeds → Vercel auto-deploys staging

# 8. Open PR on GitHub
# Include:
# - Description of feature
# - Link to E2E test
# - Any new env variables
# - Performance implications

# 9. Code review
# Reviewer checks:
# - Test coverage (no test = no merge)
# - Commit message quality
# - TypeScript strictness
# - No hardcoded secrets
# - Follows API design patterns

# 10. Merge to main
# → Vercel deploys staging
# → Manual promotion to production
```

---

### 13.4 Commit Message Format

**Template**:
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`

**Scopes**: `api`, `ui`, `scoring`, `auth`, `db`, `e2e`, etc.

**Example (good)**:
```
feat(api): add GET /api/buildings/[zip] endpoint with composite scoring

Implement core endpoint for zip search:
- Fetch open violations from Socrata API
- Compute composite score (6 factors, 0-100 scale)
- Filter to worst-first sort (lowest score = worst landlord)
- Return paginated results (limit 50, default)

Includes scoring breakdown for frontend transparency.

Test: e2e/features/zip-search.spec.ts#fetch-buildings-for-valid-zip
Fixes #128
```

**Example (bad)**:
```
feat: stuff
wip
updated
fix things
```

---

### 13.5 One Commit = One Feature Chunk

**Feature chunks** are atomic, testable, deployable pieces of work.

**Good breakdown** (4 commits for "Zip Search MVP"):
```
1. feat(ui): add zip input with validation
2. feat(api): fetch buildings from Socrata for valid zip
3. feat(scoring): compute composite score and sort results
4. feat(ui): display buildings table with scores
```

**Bad breakdown** (1 giant commit):
```
1. feat: implement entire zip search with API, scoring, UI, and styling
```

**Why?**:
- Easier to review in PR
- Easier to revert one piece if needed
- Clear commit history (what changed when)
- Each commit passes all tests independently

---

### 13.6 Code Review Checklist

Before approving a PR:

- [ ] **Tests pass**: All E2E, unit, integration tests green
- [ ] **Type safety**: TypeScript strict mode, no `any`
- [ ] **API contract**: Request/response schemas defined, error codes match spec
- [ ] **Database**: Queries use indexes, no N+1 patterns, migrations included
- [ ] **Security**: Firebase token validation on protected routes, no hardcoded secrets
- [ ] **Performance**: No images missing `lazy="true"`, no blocking main thread, LCP < 2.5s
- [ ] **Accessibility**: Form labels, ARIA, keyboard navigation tested
- [ ] **Commit messages**: Clear, reference spec/issue, include test name
- [ ] **No environment secrets**: All use `.env.local` or CI/CD secret manager

---

### 13.7 Pre-Commit Hooks (Automatic)

**When**: Every `git commit`

**Runs**:
1. `npm run lint` — ESLint + Prettier (auto-fix)
2. `npm run type-check` — TypeScript strict
3. `npm run test -- --run` — Unit + integration tests

**If any fail**: Commit blocked. Fix errors, then retry.

```bash
$ git commit -m "feat: add validation"

# Husky intercepts:
npm run lint                # ✅ or ❌
npm run type-check          # ✅ or ❌
npm run test -- --run       # ✅ or ❌

# If all pass: commit created
# If any fail: commit blocked, see error output
```

---

### 13.8 Pre-Push Hooks (Automatic)

**When**: Every `git push origin <branch>`

**Runs**:
1. `npm run build` — Full Next.js build (catches errors)
2. `npm run test:coverage` — Full test suite with coverage report
3. `npm run e2e` — E2E tests (all browsers: Chromium, Firefox, WebKit, Mobile)

**If any fail**: Push blocked. Fix, commit, retry.

```bash
$ git push origin feat/zip-validation

# Husky intercepts:
npm run build               # ✅ or ❌
npm run test:coverage       # ✅ or ❌
npm run e2e                 # ✅ or ❌ (may take 2-3 min)

# If all pass: push succeeds
# If any fail: push blocked, see error output
```

---

### 13.9 Emergency: Bypass Hooks (Discouraged)

```bash
# Skip pre-commit (NEVER use except emergency)
git commit --no-verify -m "hotfix: critical bug"

# Skip pre-push (NEVER use except emergency)
git push --no-verify

# Better: Fix, commit normally, let hooks run
git add -A
git commit -m "fix: resolve issue"
npm run test:pre-push
git push
```

---

### 13.10 Amend & Rebase Before Push

If you catch an error before pushing:

```bash
# Fix code
npm run e2e -- --headed --grep "failing test"

# Amend last commit (keep same message)
git add -A
git commit --amend --no-edit

# Re-run pre-push checks
npm run test:pre-push

# Push (if new commit)
git push --force-with-lease
```

If you already pushed and need to fix:

```bash
# Fix code
# Run tests
npm run test:all

# Commit (creates new commit on top)
git add -A
git commit -m "fix: resolve issue from previous commit"

# Push
git push origin feat/zip-validation

# Squash in PR before merge (GitHub UI) or:
git rebase -i HEAD~2  # Interactive rebase to squash
git push --force-with-lease
```

---

### 13.11 Running Tests Manually

**Watch mode** (auto-rerun on file changes):
```bash
npm run test:watch
```

**E2E with UI** (visual test player):
```bash
npm run e2e:ui
```

**E2E headed** (see browser):
```bash
npm run e2e:headed
```

**E2E debug** (step through):
```bash
npm run e2e:debug
```

**Full suite before release**:
```bash
npm run test:all

# Runs:
# 1. Lint
# 2. Type check
# 3. Unit tests
# 4. Build
# 5. Coverage report
# 6. E2E all browsers
# Takes ~5–10 minutes
```

---

### 13.12 CI/CD Integration (GitHub Actions)

On every push to `main` or `staging`:

```yaml
1. Check out code
2. Install deps
3. Lint
4. Type check
5. Unit tests
6. Full build
7. E2E tests (all browsers)
8. Upload test results + artifacts

If any fail: PR can't merge
If all pass: Auto-deploy staging, await manual promotion to prod
```

---

### 13.13 Summary Table

| Stage | Command | Time | Blocks | Automatic |
|-------|---------|------|--------|-----------|
| **Dev (watch)** | `npm run test:watch` | Instant | No | No |
| **Pre-commit** | `npm run test:pre-commit` | ~45s | Commit | ✅ Husky |
| **Pre-push** | `npm run test:pre-push` | ~5min | Push | ✅ Husky |
| **Full suite** | `npm run test:all` | ~10min | Release | Manual |
| **CI (GitHub)** | See `.github/workflows/` | ~10min | Merge | ✅ Auto |

---

## Common Workflows & Patterns

### Adding a New ZIP Search Result Sorting Option

1. **Define type** (`lib/types.ts`):
   ```typescript
   type SortBy = 'score' | 'violation_count' | 'avg_days_open';
   ```

2. **Update API route** (`app/api/buildings/[zip]/route.ts`):
   ```typescript
   const { sort = 'score' } = req.nextUrl.searchParams;
   const query = `
     SELECT * FROM buildings WHERE zip = $1
     ORDER BY ${sortBy(sort)} ASC
     LIMIT 50
   `;
   ```

3. **Add to frontend component** (`components/BuildingList.tsx`):
   ```typescript
   const [sortBy, setSortBy] = useState<SortBy>('score');
   ```

4. **Test**: Unit test `sortBy()` function; E2E test clicking sort dropdown.

### Debugging a Slow Zip Search

1. Check API response time: `curl -w "@curl-format.txt" http://localhost:3000/api/buildings/10001`.
2. If slow, run `EXPLAIN ANALYZE` on the SQL query in psql.
3. Check if index exists: `\d buildings` in psql; add index if missing.
4. Check Socrata API logs for rate limiting.
5. Check React Query cache: Open DevTools → Network → XHR, verify cache headers.

### Handling a Breaking Change in Socrata Response

1. Add a **feature flag** (`lib/config.ts`):
   ```typescript
   const SOCRATA_V4_ENABLED = process.env.SOCRATA_V4 === 'true';
   ```

2. Version the parsing logic:
   ```typescript
   const parsed = SOCRATA_V4_ENABLED 
     ? parseSocrataV4(raw) 
     : parseSocrataV3(raw);
   ```

3. Test both branches locally.
4. Deploy with flag off; enable in staging first; gather metrics; enable in production.

---

## Success Metrics

- **User acquisition**: Organic SEO traffic to `/[zip]` pages; target 100 searches/day by month 3.
- **Product usage**: Average session duration > 2 min; return rate > 20%.
- **Data quality**: Scoring algorithm alignment with renter feedback; target 80%+ agreement ("This score matches my experience").
- **Performance**: LCP < 2.5s; P95 API latency < 500ms.
- **Reliability**: 99.5% uptime; <1% error rate on zip search API.

---

## Known Limitations & Future Work

1. **Landlord portfolio profiles**: Requires parsing `Landlord` field across all NYC buildings (data availability unclear). Premium tier feature.
2. **Recurring same-issue factor**: Sixth scoring component needs violation de-duplication logic (same address, same issue category, multiple reopenings). In progress.
3. **Predictive maintenance**: Model time-to-resolution for new violations. Post-MVP research.
4. **Mobile heatmap**: Mapbox GL JS on mobile is performant; needs UX polish (touch zoom, info windows).

---

## References

- [Next.js 14 Docs](https://nextjs.org/docs)
- [React 18 Server Components](https://react.dev/reference/react/use-server)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [PostgreSQL Query Optimization](https://www.postgresql.org/docs/current/sql-explain.html)
- [NYC HPD Open Data Portal](https://data.cityofnewyork.us/)
- [Socrata API Docs](https://dev.socrata.com/)
- [Web Vitals](https://web.dev/vitals/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
