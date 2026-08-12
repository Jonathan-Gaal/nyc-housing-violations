# Open Violation E2E Testing & Git Workflow
## Test-First Development with Playwright, Pre-Commit Hooks, and Disciplined Commits

---

## Overview

**Development Model**: Test-Driven Development (TDD) with strict commit discipline.

**Flow**:
1. Write E2E test for feature (red)
2. Implement feature until test passes (green)
3. Run full test suite locally (`npm run test:all`)
4. Commit with descriptive message (no push yet)
5. Before push: Run pre-push hooks (`npm run test:pre-push`)
6. Push only when all tests + build are green

**Each logical feature chunk = one commit.** No monolithic 500-line commits. Examples:
- ✅ Commit 1: "feat: add zip input validation test and implementation"
- ✅ Commit 2: "feat: fetch buildings from Socrata API for valid zip"
- ✅ Commit 3: "feat: compute composite score and display in results table"
- ✅ Commit 4: "feat: sort buildings by score (worst first)"
- ❌ Avoid: "feat: implement entire zip search feature with API, scoring, and sorting"

---

## Part 1: Playwright E2E Testing Setup

### 1.1 Installation & Configuration

```bash
cd web

# Install Playwright and dependencies
npm install --save-dev @playwright/test @testing-library/react @testing-library/jest-dom

# Create playwright config
npx playwright install
```

**File: `web/playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,
  
  /* Shared settings for all reporters */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['list'],
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: 'http://localhost:3000',
    
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Video on failure (slower) */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

### 1.2 Test Directory Structure

```
web/
├── e2e/
│   ├── fixtures/
│   │   ├── auth.fixture.ts          # Pre-authenticated session
│   │   ├── db.fixture.ts            # Test data seeding
│   │   └── api.fixture.ts           # Mock API responses
│   ├── helpers/
│   │   ├── navigation.ts            # Reusable page interactions
│   │   ├── assertions.ts            # Custom matchers
│   │   └── test-data.ts             # Sample buildings, users, etc.
│   ├── smoke/
│   │   └── health.spec.ts           # Basic sanity checks
│   ├── auth/
│   │   ├── login.spec.ts
│   │   └── signup.spec.ts
│   └── features/
│       ├── zip-search.spec.ts       # Core feature: zip search
│       ├── building-detail.spec.ts  # Core feature: building page
│       ├── sorting.spec.ts          # Sorting buildings
│       ├── filtering.spec.ts        # Filtering by status
│       └── landlord-profile.spec.ts # Premium feature (future)
├── playwright.config.ts
├── package.json
└── .gitignore (add: playwright-report/, test-results/)
```

### 1.3 Example: Zip Search Test (Before Implementation)

**File: `web/e2e/features/zip-search.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Zip Search Feature', () => {
  test('should display zip input on home page', async ({ page }) => {
    await page.goto('/');
    const zipInput = page.getByLabel('Enter zip code');
    await expect(zipInput).toBeVisible();
  });

  test('should validate zip format (must be 5 digits)', async ({ page }) => {
    await page.goto('/');
    const zipInput = page.getByLabel('Enter zip code');
    
    // Type invalid zip
    await zipInput.fill('ABC');
    await page.getByRole('button', { name: 'Search' }).click();
    
    // Expect error message
    const errorMsg = page.getByText('Zip code must be 5 digits');
    await expect(errorMsg).toBeVisible();
  });

  test('should fetch and display buildings for valid zip', async ({ page }) => {
    await page.goto('/');
    const zipInput = page.getByLabel('Enter zip code');
    
    // Enter valid zip
    await zipInput.fill('10001');
    await page.getByRole('button', { name: 'Search' }).click();
    
    // Wait for results
    await page.waitForURL('**/10001');
    
    // Expect buildings table
    const buildingTable = page.getByRole('table');
    await expect(buildingTable).toBeVisible();
    
    // Expect at least one building row
    const buildingRows = page.getByRole('row');
    const count = await buildingRows.count();
    expect(count).toBeGreaterThan(1); // Header + at least 1 data row
  });

  test('should display building score and violation count', async ({ page }) => {
    await page.goto('/10001');
    
    const scoreColumn = page.getByRole('columnheader', { name: /score/i });
    const violationColumn = page.getByRole('columnheader', { name: /violations/i });
    
    await expect(scoreColumn).toBeVisible();
    await expect(violationColumn).toBeVisible();
    
    // Verify data cells exist
    const scoreCells = page.locator('td:has-text(/^[0-9]{1,3}$/)');
    expect(await scoreCells.count()).toBeGreaterThan(0);
  });

  test('should sort buildings by score (worst first)', async ({ page }) => {
    await page.goto('/10001');
    
    // Get first two score values
    const scoreCell1 = page.locator('table tbody tr:first-child td:nth-child(3)');
    const scoreCell2 = page.locator('table tbody tr:nth-child(2) td:nth-child(3)');
    
    const score1 = parseFloat(await scoreCell1.textContent() || '0');
    const score2 = parseFloat(await scoreCell2.textContent() || '0');
    
    // Worst scores should come first (lower scores are worse)
    expect(score1).toBeLessThanOrEqual(score2);
  });

  test('should click building row to view details', async ({ page }) => {
    await page.goto('/10001');
    
    // Click first building row
    await page.locator('table tbody tr:first-child').click();
    
    // Should navigate to building detail page
    await page.waitForURL(/\/10001\/\d+/);
    
    // Expect detail page content
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toBeVisible();
  });
});
```

### 1.4 Fixtures (Pre-Configured Test Sessions)

**File: `web/e2e/fixtures/auth.fixture.ts`**

```typescript
import { test as base, expect } from '@playwright/test';
import * as firebase from 'firebase-admin';

type AuthFixtures = {
  authenticatedPage: any;
  testUser: { uid: string; email: string };
};

export const test = base.extend<AuthFixtures>({
  testUser: async ({}, use) => {
    // Create or get test user
    const testUser = {
      uid: 'test-user-123',
      email: 'test@open-violation.local',
    };
    
    yield testUser;

    // Cleanup (optional: delete test user after tests)
    // await firebase.auth().deleteUser(testUser.uid);
  },

  authenticatedPage: async ({ page, testUser }, use) => {
    // Set auth token in localStorage (mock or real)
    await page.goto('/');
    
    const token = 'test-jwt-token-here'; // In real scenario, call Firebase API
    await page.evaluate((t) => {
      localStorage.setItem('firebaseAuthToken', t);
    }, token);

    yield page;
  },
});

export { expect };
```

### 1.5 Test Helpers (Reusable Utilities)

**File: `web/e2e/helpers/navigation.ts`**

```typescript
import { Page } from '@playwright/test';

export async function searchZip(page: Page, zip: string) {
  const zipInput = page.getByLabel('Enter zip code');
  await zipInput.fill(zip);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForURL(`**/${zip}`);
}

export async function clickBuilding(page: Page, index: number = 0) {
  const rows = page.locator('table tbody tr');
  await rows.nth(index).click();
}

export async function getScoreColumn(page: Page) {
  const cells = page.locator('table tbody td:nth-child(3)'); // Adjust column index
  const scores: number[] = [];
  const count = await cells.count();
  for (let i = 0; i < count; i++) {
    const text = await cells.nth(i).textContent();
    scores.push(parseFloat(text || '0'));
  }
  return scores;
}

export async function expectErrorMessage(page: Page, message: string | RegExp) {
  const error = page.getByRole('alert');
  await error.getByText(message).waitFor();
}
```

**File: `web/e2e/helpers/test-data.ts`**

```typescript
export const TEST_ZIPS = {
  CHELSEA: '10001',
  EAST_VILLAGE: '10009',
  WILLIAMSBURG: '11211',
  INVALID: 'ABC',
  OUT_OF_RANGE: '99999',
};

export const TEST_BUILDINGS = {
  CHELSEA_1: {
    bin: '1000001',
    address: '123 Main St',
    zip: '10001',
    violations: 45,
    score: 22,
  },
  CHELSEA_2: {
    bin: '1000002',
    address: '456 Park Ave',
    zip: '10001',
    violations: 12,
    score: 68,
  },
};

export const TEST_USERS = {
  FREE_TIER: {
    email: 'free@open-violation.local',
    tier: 'free',
  },
  PREMIUM: {
    email: 'premium@open-violation.local',
    tier: 'premium',
  },
};
```

---

## Part 2: Pre-Commit & Pre-Push Hooks

### 2.1 Husky + Lint-Staged Setup

```bash
cd web

# Install husky and lint-staged
npm install --save-dev husky lint-staged

# Initialize husky
npx husky install

# Create pre-commit hook
npx husky add .husky/pre-commit "npm run test:pre-commit"

# Create pre-push hook
npx husky add .husky/pre-push "npm run test:pre-push"
```

### 2.2 Package.json Scripts

**File: `web/package.json`** (add to `scripts` section)

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "e2e:debug": "playwright test --debug",
    "e2e:headed": "playwright test --headed",
    
    "test:pre-commit": "npm run lint && npm run type-check && npm run test -- --run",
    "test:pre-push": "npm run build && npm run test:coverage && npm run e2e",
    "test:all": "npm run lint && npm run type-check && npm run test -- --run && npm run build && npm run e2e",
    
    "lint": "eslint . --ext .ts,.tsx --fix",
    "type-check": "tsc --noEmit",
    
    "db:migrate": "pg-migrate up",
    "db:seed": "ts-node scripts/seed.ts"
  },
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md}": [
      "prettier --write"
    ]
  }
}
```

### 2.3 Pre-Commit Hook Workflow

**What runs before every commit:**

```bash
$ git commit -m "feat: add zip validation"

# Pre-commit hook triggers automatically:
1. npm run lint                # ESLint + Prettier
2. npm run type-check          # TypeScript strict mode
3. npm run test -- --run       # Unit + integration tests (fast, ~30s)

# If all green:
  ✅ Commit created

# If any fail:
  ❌ Commit blocked
     (Fix errors, run commands manually, then retry commit)
```

### 2.4 Pre-Push Hook Workflow

**What runs before every push to origin:**

```bash
$ git push origin feat/zip-validation

# Pre-push hook triggers automatically:
1. npm run build               # Full Next.js build (catches errors)
2. npm run test:coverage       # Full test suite with coverage report
3. npm run e2e                 # E2E tests (Playwright, all browsers)

# If all green:
  ✅ Push succeeds

# If any fail:
  ❌ Push blocked
     (Fix errors, commit again, retry push)
```

---

## Part 3: Development Workflow (Step-by-Step)

### 3.1 Feature: Zip Code Input Validation

**Step 1: Create E2E test** (RED)

```typescript
// e2e/features/zip-search.spec.ts
test('should validate zip code format', async ({ page }) => {
  await page.goto('/');
  const zipInput = page.getByLabel('Enter zip code');
  
  // Invalid: too short
  await zipInput.fill('123');
  await page.getByRole('button', { name: 'Search' }).click();
  
  const error = page.getByText('Zip code must be exactly 5 digits');
  await expect(error).toBeVisible();
});
```

**Run test** (fails because feature doesn't exist):

```bash
npm run e2e -- --grep "validate zip code format"
# ❌ FAILED: Element not found
```

**Step 2: Implement feature** (GREEN)

```typescript
// app/(app)/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [zip, setZip] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const validateZip = (value: string) => {
    if (!/^\d{5}$/.test(value)) {
      setError('Zip code must be exactly 5 digits');
      return false;
    }
    setError('');
    return true;
  };

  const handleSearch = () => {
    if (validateZip(zip)) {
      router.push(`/${zip}`);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Open Violation</h1>
      <label htmlFor="zip-input">Enter zip code</label>
      <input
        id="zip-input"
        type="text"
        value={zip}
        onChange={(e) => {
          setZip(e.target.value);
          validateZip(e.target.value);
        }}
        className="border px-4 py-2 rounded"
        placeholder="10001"
      />
      {error && <div role="alert" className="text-red-600 mt-2">{error}</div>}
      <button
        onClick={handleSearch}
        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded"
      >
        Search
      </button>
    </div>
  );
}
```

**Run test** (passes):

```bash
npm run e2e -- --grep "validate zip code format"
# ✅ PASSED
```

**Step 3: Run pre-commit checks locally**

```bash
npm run test:pre-commit

# Lint ✅
# Type check ✅
# Unit tests ✅
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add zip code input with format validation

- Validate zip must be exactly 5 digits
- Show error message for invalid input
- Disable search button until valid

Test: e2e/features/zip-search.spec.ts#validate-zip-code-format"
```

Husky runs pre-commit hooks automatically:
- ✅ Lint passes
- ✅ Type check passes
- ✅ Unit tests pass
- 🎉 Commit succeeds

**Step 5: Before push, run pre-push checks**

```bash
npm run test:pre-push

# Build ✅
# Test coverage ✅
# E2E tests (Chromium, Firefox, WebKit, Mobile) ✅
```

**Step 6: Push**

```bash
git push origin feat/zip-validation
```

Husky runs pre-push hooks automatically:
- ✅ Build passes
- ✅ All tests pass
- 🎉 Push succeeds → Vercel auto-deploys

---

### 3.2 Feature: Fetch Buildings from API

**Step 1: E2E test**

```typescript
test('should fetch buildings for valid zip', async ({ page }) => {
  await page.goto('/');
  const zipInput = page.getByLabel('Enter zip code');
  await zipInput.fill('10001');
  await page.getByRole('button', { name: 'Search' }).click();
  
  // Wait for navigation
  await page.waitForURL('**/10001');
  
  // Expect buildings table
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  
  // Expect at least one building
  const rows = page.locator('table tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
});
```

**Step 2: Create API route + component**

```typescript
// app/api/buildings/[zip]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchOpenViolations } from '@/lib/api';
import { scoreBuilding } from '@/lib/scoring';

export async function GET(
  req: NextRequest,
  { params }: { params: { zip: string } }
) {
  try {
    const { zip } = params;

    // Validate zip
    if (!/^\d{5}$/.test(zip)) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_ZIP', message: 'Invalid zip code' } },
        { status: 400 }
      );
    }

    // Fetch violations from Socrata
    const violations = await fetchOpenViolations(zip);

    // Group by BIN and score
    const buildingMap = new Map<string, any>();
    violations.forEach((v) => {
      if (!buildingMap.has(v.bin)) {
        buildingMap.set(v.bin, {
          bin: v.bin,
          address: v.address,
          zip,
          violations: [],
        });
      }
      buildingMap.get(v.bin).violations.push(v);
    });

    // Score each building
    const buildings = Array.from(buildingMap.values())
      .map((b) => ({
        ...b,
        score: scoreBuilding(b.violations),
      }))
      .sort((a, b) => a.score - b.score) // Worst first
      .slice(0, 50); // Top 50

    return NextResponse.json({ ok: true, data: buildings });
  } catch (error) {
    console.error('Error fetching buildings:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch buildings' } },
      { status: 500 }
    );
  }
}
```

```typescript
// app/(app)/[zip]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Building = {
  bin: string;
  address: string;
  violations: number;
  score: number;
};

export default function ZipResults() {
  const { zip } = useParams();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await fetch(`/api/buildings/${zip}`);
        const data = await res.json();
        if (data.ok) {
          setBuildings(data.data);
        } else {
          setError(data.error.message);
        }
      } catch (e) {
        setError('Failed to load buildings');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [zip]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div role="alert">{error}</div>;

  return (
    <table>
      <thead>
        <tr>
          <th>Address</th>
          <th>Violations</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        {buildings.map((b) => (
          <tr key={b.bin}>
            <td>{b.address}</td>
            <td>{b.violations.length}</td>
            <td>{b.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: fetch and display buildings for zip code

- Create /api/buildings/[zip] endpoint
- Filter open violations from Socrata API
- Score buildings by responsiveness composite
- Display in results table (worst first)

Test: e2e/features/zip-search.spec.ts#fetch-buildings-for-valid-zip"
```

---

### 3.3 Feature: Composite Scoring Display

**E2E test:**

```typescript
test('should display score breakdown', async ({ page }) => {
  await page.goto('/10001');
  
  // Click first building to view details
  await page.locator('table tbody tr:first-child').click();
  
  await page.waitForURL(/\/10001\/\d+/);
  
  // Expect score breakdown card
  const breakdown = page.getByText(/violation count: \d+%/i);
  await expect(breakdown).toBeVisible();
  
  const rentImpairing = page.getByText(/rent-impairing: \d+%/i);
  await expect(rentImpairing).toBeVisible();
});
```

**Commit:**

```bash
git commit -m "feat: show scoring breakdown on building detail page

- Display all 6 scoring factors with percentages
- Add transparency to algorithm
- Help renters understand landlord responsiveness rating

Test: e2e/features/building-detail.spec.ts#display-score-breakdown"
```

---

## Part 4: Git Commit Discipline

### 4.1 Commit Message Convention

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`

**Scope**: `api`, `ui`, `scoring`, `auth`, `db`, etc.

**Examples**:

```
✅ feat(api): add /api/buildings/[zip] endpoint with scoring
✅ fix(ui): resolve date parsing bug in violation timeline
✅ test(e2e): add test for zip validation error message
✅ refactor(scoring): extract common violation grouping logic

❌ feat: stuff
❌ updated things
❌ WIP
```

### 4.2 One Commit Per Feature Chunk

**Good breakdown** (4 commits):

1. `feat(ui): add zip input with validation`
2. `feat(api): fetch buildings from Socrata for valid zip`
3. `feat(scoring): compute composite score and sort by responsiveness`
4. `feat(ui): display buildings table with score and violations`

**Bad breakdown** (1 giant commit):

- `feat: implement entire zip search with API, scoring, validation, and UI`

### 4.3 Amending Commits Before Push

If pre-push tests fail:

```bash
# Fix the issue
npm run e2e -- --headed --grep "your failing test"

# (implement fix)

# Amend the last commit (don't create new one)
git add -A
git commit --amend --no-edit

# Re-run pre-push checks
npm run test:pre-push

# If all green, push (force-push if already pushed)
git push origin feat/zip-validation --force-with-lease
```

---

## Part 5: Sample Test Execution

### Run During Development

```bash
# Watch mode (auto-rerun on file changes)
npm run test:watch

# Watch E2E tests with UI
npm run e2e:ui

# E2E tests in headed mode (see browser)
npm run e2e:headed

# E2E tests in debug mode (interactive)
npm run e2e:debug
```

### Run Before Commit (Automatic via Husky)

```bash
git commit -m "feat: add validation"

# Husky pre-commit hook runs:
npm run test:pre-commit

# Output:
# ✅ Linting passed
# ✅ Type checking passed
# ✅ Unit tests passed
# → Commit created
```

### Run Before Push (Automatic via Husky)

```bash
git push

# Husky pre-push hook runs:
npm run test:pre-push

# Output:
# ✅ Build succeeded
# ✅ Test coverage met
# ✅ E2E tests passed (Chromium, Firefox, WebKit, Mobile)
# → Push succeeded
```

### Full Suite (Manual, Pre-Release)

```bash
npm run test:all

# Runs:
# 1. npm run lint
# 2. npm run type-check
# 3. npm run test -- --run (unit/integration)
# 4. npm run build
# 5. npm run test:coverage
# 6. npm run e2e (all browsers)

# If all pass: Ready for production release
```

---

## Part 6: CI/CD Integration (GitHub Actions)

**File: `.github/workflows/test.yml`**

```yaml
name: Test & Build

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main, staging]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
          cache: 'npm'

      - run: cd web && npm ci
      - run: cd web && npm run lint
      - run: cd web && npm run type-check
      - run: cd web && npm run test -- --run
      - run: cd web && npm run build
      - run: cd web && npx playwright install --with-deps
      - run: cd web && npm run e2e

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: web/playwright-report/
          retention-days: 30
```

---

## Success Criteria

✅ **Local Development**:
- Every feature has E2E test written first (red)
- Feature implemented until test passes (green)
- Pre-commit hooks block commits with failing tests
- Each commit is atomic (one logical feature)
- Pre-push hooks block pushes with failing build or E2E tests

✅ **Code Quality**:
- 80%+ test coverage (critical paths: API routes, scoring algorithm)
- TypeScript strict mode enabled
- No linting errors
- All E2E tests pass on Chromium, Firefox, WebKit, Mobile

✅ **Deployment**:
- GitHub Actions runs full test suite on every PR
- Staging environment auto-deploys on merge to `staging` branch
- Production deploys only after manual promotion (no auto-deploy from main)

✅ **Team Discipline**:
- No commits bypass pre-commit hooks (no `git commit --no-verify`)
- No pushes bypass pre-push hooks (no `git push --no-verify`)
- PR reviews check test evidence + commit message quality
- Release candidate requires full `npm run test:all` pass

---

## Troubleshooting

### Tests Timing Out

```bash
# Increase timeout in playwright.config.ts
use: {
  navigationTimeout: 30000, // 30s
  actionTimeout: 10000,     // 10s
}

# Or increase for specific test
test.setTimeout(60000);
```

### Test Flakiness on CI

Common causes:
- Database not ready: Add health check to `services.postgres`
- Next.js server not ready: Increase `timeout` in `webServer`
- Race conditions: Use `waitForURL()`, `waitForNavigation()`, not just `goto()`

### Pre-Commit Hook Bypass (Emergency Only)

```bash
# Skip hooks (DANGEROUS—only for emergencies)
git commit --no-verify -m "hotfix: urgent bug"

# But still run pre-push hooks
git push  # Pre-push still runs
```

### Pre-Push Hook Bypass

```bash
# Never do this except in critical situations
git push --no-verify

# Better: Fix the issue, amend, repush
git add -A
git commit --amend --no-edit
npm run test:pre-push  # Verify
git push --force-with-lease
```

---

## Summary

| Stage | Command | Time | Blocks |
|-------|---------|------|--------|
| **Development** | `npm run test:watch` | Instant | None (watch) |
| **Pre-Commit** | `npm run test:pre-commit` (auto via Husky) | ~45s | Commit ❌ |
| **Pre-Push** | `npm run test:pre-push` (auto via Husky) | ~5min | Push ❌ |
| **CI/CD** | GitHub Actions (on PR/push) | ~10min | Merge ❌ |

**End result**: Every commit on `main` is tested, every push is verified, and no failing code reaches production.
