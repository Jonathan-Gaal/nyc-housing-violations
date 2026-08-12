# Open Violation Product Specification
## Data-Driven NYC Rental Research Platform

---

## 1. Product Overview

### 1.1 Mission

Enable budget-conscious NYC renters to **avoid buildings where landlords chronically ignore tenant complaints**, by providing data-driven landlord responsiveness ratings.

### 1.2 Core Insight

**Violation count alone is a weak signal.** A building with 100 open violations where the landlord actively resolves issues is safer than a building with 20 violations where the landlord ignores complaints indefinitely.

**What matters**: Landlord **responsiveness**—how quickly and completely they resolve complaints once filed.

### 1.3 Competitive Differentiation

Existing tools (OpenIgloo, Augrented, DwellCheck) focus on violation *volume* and *density*. Open Violation adds:

1. **Composite responsiveness score** (6 factors, not just count)
2. **Instant zip-code search** (no registration, no map navigation)
3. **Heatmap by neighborhood** (where are the most unresponsive landlords?)
4. **Landlord portfolio view** (premium: see how one landlord manages all their properties)

---

## 2. User Personas & Journeys

### 2.1 Primary: Budget-Conscious Renter (Kara)

**Demographics**: 28, works in tech/finance, searching for first solo apartment, budget $2,000–3,000/month.

**Motivation**: 
- Wants a safe, well-maintained apartment
- Has heard stories of unresponsive landlords
- Checking violation data is part of apartment hunting research

**Journey**:
1. Uses Google → "best apartments in Chelsea" → finds listing
2. Gets address, extracts zip code (10001)
3. Opens Open Violation on phone, enters zip
4. Sees Chelsea buildings ranked by landlord responsiveness
5. Checks listing address against results → sees responsiveness score
6. Feels informed → proceeds to lease or keeps searching

**Quote**: *"I need to know the landlord will actually fix things when they break. Violation count doesn't tell me that."*

### 2.2 Secondary: Cautious Renter (Marcus)

**Demographics**: 35, moving to NYC for job, wants to understand neighborhood risks.

**Motivation**:
- Unfamiliar with NYC; wants data-driven neighborhood insights
- Willing to pay for landlord portfolio profiles (see all properties one owner manages)

**Journey**:
1. Researching 3 neighborhoods (Williamsburg, Park Slope, Astoria)
2. Enters all 3 zips into Open Violation
3. Compares neighborhood-level violation patterns
4. Upgrades to Premium → views landlord portfolio for top building addresses
5. Learns: Owner X has 50 properties, 60% with unresolved violations → avoids
6. Identifies trustworthy owners → focuses search on their properties

**Quote**: *"Show me which landlords are actually responsible across all their buildings."*

### 2.3 Tertiary: Tenant Advocate (Dr. Chen)

**Demographics**: Nonprofit affordable housing advocate, using Open Violation in outreach.

**Motivation**:
- Identify worst-actor landlords for policy advocacy
- Generate reports for tenant unions

**Journey**:
1. Downloads CSV of all violations for 5 zip codes
2. Filters for unresolved violations >2 years
3. Generates heat map of non-compliance by landlord
4. Presents findings to City Council committee
5. Data informs enforcement priorities for HPD

**Quote**: *"The city's enforcement is reactive. Show us proactively where landlords are ignoring complaints."*

---

## 3. Feature Roadmap

### 3.1 MVP (Weeks 1–4)

**Core functionality**: Zip → Buildings ranked by responsiveness.

#### Features

| Feature | Priority | Status |
|---------|----------|--------|
| Zip code search | P0 | Planning |
| Building results table | P0 | Planning |
| Composite score display | P0 | Planning |
| Worst-first sorting | P0 | Planning |
| Building detail page | P0 | Planning |
| Violation timeline chart | P0 | Planning |
| Mobile responsive design | P0 | Planning |
| Firebase Auth (Google/email) | P0 | Planning |

**Out of scope for MVP**:
- Landlord portfolio profiles
- Heatmap by neighborhood
- Data export/CSV
- Saved buildings / favorites

---

### 3.2 Phase 2 (Weeks 5–8)

**Premium tier launch**: Landlord portfolio profiles.

#### Features

| Feature | Tier | Description |
|---------|------|-------------|
| Landlord portfolio search | Premium | Enter landlord name → see all properties they own/manage |
| Portfolio statistics | Premium | Total properties, avg score, repeat issues by category |
| Email alerts | Premium | Notify when violations added/resolved for tracked buildings |
| Custom reports | Premium | Export filtered violations to PDF for specific zip/timeframe |
| Advanced filtering | Premium | Filter by violation category, status, date range |

**Pricing**: 
- Free: Zip search + building results
- Premium: $4.99/month or $49/year (portfolio + alerts + reports)

---

### 3.3 Phase 3 (Weeks 9–12)

**Data enrichment & predictive insights**.

#### Features

| Feature | Description |
|---------|-------------|
| Neighborhood heatmap | Visualize landlord responsiveness density by neighborhood |
| Predicted resolution time | ML model: Given new violation, estimate when it will resolve based on landlord history |
| Comparison tool | "How does this landlord compare to others in this zip?" |
| API for researchers | Rate-limited public API for academic studies |

---

## 4. Scoring Algorithm

### 4.1 Composite Score Formula

**Base formula**: `Score = (Factor1 × 0.25) + (Factor2 × 0.25) + (Factor3 × 0.20) + (Factor4 × 0.15) + (Factor5 × 0.15) + (Factor6 × TBD)`

**Scale**: 0–100 (lower = worse landlord, more responsive)

**Interpretation**:
- 0–20: Chronic non-compliance, unresponsive landlord
- 21–40: Significant backlog, slow resolution
- 41–60: Mixed record, some responsiveness
- 61–80: Generally responsive, few stuck violations
- 81–100: Exemplary record, rapid resolution

### 4.2 The Six Factors

#### Factor 1: Total Violations (25%)

**Definition**: Total count of open violations in building.

**Rationale**: More violations = more tenant complaints = either more problems or (if resolved quickly) baseline activity level.

**Calculation**:
```
component1 = (total_violations / max_violations_in_zip) × 100
```

Example:
- Building has 45 open violations
- Max in zip (10001) is 200
- Component 1 = (45 / 200) × 100 = 22.5 points (unscaled)

---

#### Factor 2: Rent-Impairing Violations (25%)

**Definition**: Violations for issues that affect habitability (heat, hot water, mold, vermin, broken locks, no stove, etc.).

**Rationale**: Rent-impairing violations block lawful deductions under NY law; they're urgent and enforceable.

**Calculation**:
```
rent_impairing_count = count(violations where category in RENT_IMPAIRING_CATEGORIES)
component2 = (rent_impairing_count / total_violations) × 100
```

**Rent-impairing categories** (NYC Housing Maintenance Code):
- Heat/hot water
- Mold/lead
- Broken windows
- Vermin
- No stove/refrigerator
- Broken locks/doors
- Hazardous conditions

Example:
- Building has 45 open violations; 18 are rent-impairing
- Component 2 = (18 / 45) × 100 = 40%

---

#### Factor 3: Average Years Stuck Open (20%)

**Definition**: Average time (in years) that open violations have been sitting unresolved.

**Rationale**: Age of violation is the strongest signal of landlord responsiveness. Fresh violations get resolved; ancient violations never will.

**Calculation**:
```
avg_days_stuck = mean(days_since_opened) for all open violations
avg_years_stuck = avg_days_stuck / 365

component3 = min(avg_years_stuck / 8, 1.0) × 100
```

(Capped at 8 years = 100% component penalty; buildings with violations stuck >8 years all score the same on this factor.)

Example:
- Average violation is 2,000 days old = 5.48 years
- Component 3 = min(5.48 / 8, 1.0) × 100 = 68.5%

---

#### Factor 4: Percent in Dead-End Statuses (15%)

**Definition**: Percent of violations in unproductive statuses (HPD gave up or landlord refused).

**Rationale**: Violations in dead-end statuses never get resolved; they signal systemic non-compliance.

**Dead-end statuses**:
- `NOV SENT OUT` (notice issued but ignored)
- `NOT COMPLIED WITH` (violation confirmed, landlord refused to fix)
- `NO ACCESS TO INSPECT` (HPD gave up, can't gain entry)

**Calculation**:
```
dead_end_count = count(violations where status in DEAD_END_STATUSES)
component4 = (dead_end_count / total_violations) × 100
```

Example:
- 45 open violations; 35 in dead-end statuses
- Component 4 = (35 / 45) × 100 = 77.8%

---

#### Factor 5: Percent Reissued Violations (15%)

**Definition**: Percent of violations that were reissued after initial closure (closed then reopened for same issue at same address).

**Rationale**: Reissued violations show the landlord fixed the problem temporarily (e.g., exterminator visit without addressing root cause) then the issue recurred. Sign of sloppy repairs.

**Calculation**:
```
reissued_count = count(violations where is_reissued)
component5 = (reissued_count / total_violations) × 100
```

Example:
- Building has 45 violations; 9 are reissued
- Component 5 = (9 / 45) × 100 = 20%

---

#### Factor 6: Recurring Same-Issue Factor (TBD, ~5%)

**Definition**: Violations for the same issue category at the same building in the same year (e.g., "No heat" issued twice in winter 2023).

**Rationale**: Recurring same issue = landlord didn't actually fix the root problem.

**Status**: In design; requires violation deduplication logic. Exploratory.

---

### 4.3 Response Schema

All API responses include `scoringBreakdown` for transparency:

```json
{
  "ok": true,
  "data": {
    "buildings": [
      {
        "bin": "1000001",
        "address": "123 Main St, New York, NY 10001",
        "zip": "10001",
        "score": 28,
        "scoringBreakdown": {
          "totalViolations": {
            "value": 22.5,
            "weight": 0.25,
            "explanation": "45 violations out of 200 max in zip"
          },
          "rentImpairingPercent": {
            "value": 40,
            "weight": 0.25,
            "explanation": "40% of violations are habitability-affecting"
          },
          "avgYearsStuckOpen": {
            "value": 68.5,
            "weight": 0.20,
            "explanation": "Average violation open 5.48 years"
          },
          "deadEndStatusPercent": {
            "value": 77.8,
            "weight": 0.15,
            "explanation": "77.8% of violations in unproductive status"
          },
          "reissuedPercent": {
            "value": 20,
            "weight": 0.15,
            "explanation": "20% of violations were reopened for same issue"
          },
          "recurringIssue": {
            "value": null,
            "weight": 0.0,
            "explanation": "Not yet computed"
          }
        },
        "violationCount": 45,
        "rentImpairingCount": 18,
        "avgDaysOpen": 2000
      }
    ]
  }
}
```

---

## 5. Data Model

### 5.1 Database Schema

#### `buildings` Table

```sql
CREATE TABLE buildings (
  bin TEXT PRIMARY KEY,           -- NYC Building Identification Number
  address TEXT NOT NULL,
  zip TEXT NOT NULL,
  landlord_id TEXT,               -- For portfolio view (future)
  score FLOAT,                    -- Composite score (0–100)
  score_breakdown JSONB,          -- All 6 components + breakdown
  violation_count INT,
  rent_impairing_count INT,
  avg_days_open FLOAT,
  dead_end_percent FLOAT,
  reissued_percent FLOAT,
  last_updated TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_buildings_zip_score ON buildings(zip, score);
CREATE INDEX idx_buildings_zip ON buildings(zip);
```

#### `violations` Table

```sql
CREATE TABLE violations (
  violation_id TEXT PRIMARY KEY,
  bin TEXT NOT NULL REFERENCES buildings(bin),
  address TEXT,
  zip TEXT,
  status TEXT,                   -- 'OPEN', 'CLOSED', 'NOV SENT OUT', etc.
  opened_date DATE,
  closed_date DATE,
  category TEXT,                 -- 'Heat', 'Mold', 'Vermin', etc.
  is_rent_impairing BOOLEAN,
  is_reissued BOOLEAN,
  description TEXT,
  last_updated TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_violations_bin ON violations(bin);
CREATE INDEX idx_violations_status ON violations(status);
```

#### `users` Table (Future: Freemium)

```sql
CREATE TABLE users (
  firebase_uid TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  tier TEXT DEFAULT 'free',       -- 'free' | 'premium'
  stripe_customer_id TEXT,
  subscription_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);
```

#### `saved_buildings` Table (Future)

```sql
CREATE TABLE saved_buildings (
  id SERIAL PRIMARY KEY,
  firebase_uid TEXT REFERENCES users(firebase_uid),
  bin TEXT REFERENCES buildings(bin),
  saved_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_saved_buildings_user ON saved_buildings(firebase_uid);
```

---

### 5.2 Data Freshness & Sync

**Source**: NYC HPD Open Data API (Socrata v3)

**Sync cadence**: Nightly batch job (12:00 AM UTC)

**Process**:
1. Query Socrata for all violations updated in past 24 hours
2. Validate response shape (schema check)
3. Upsert into `violations` table
4. Recalculate `buildings` scores for affected BINs
5. Log sync completion + row counts

**Staleness acceptable**: ±12 hours (data from yesterday is ~acceptable for a renter)

---

## 6. API Specification

### 6.1 Public Endpoints (No Auth Required)

#### GET `/api/public/buildings/:zip`

**Description**: Fetch buildings for a zip code, sorted by landlord responsiveness (worst first).

**Parameters**:
```
zip: string (required, 5 digits)
limit?: number (default 50, max 200)
offset?: number (default 0)
```

**Response** (200 OK):
```json
{
  "ok": true,
  "data": {
    "zip": "10001",
    "buildings": [
      {
        "bin": "1000001",
        "address": "123 Main St",
        "score": 28,
        "scoringBreakdown": { ... },
        "violationCount": 45,
        "rentImpairingCount": 18
      }
    ],
    "pagination": {
      "total": 145,
      "limit": 50,
      "offset": 0
    }
  }
}
```

**Error** (400 Bad Request):
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ZIP",
    "message": "Zip code must be exactly 5 digits",
    "statusCode": 400
  }
}
```

**Error** (500 Server Error):
```json
{
  "ok": false,
  "error": {
    "code": "SOCRATA_ERROR",
    "message": "Failed to fetch from NYC HPD API",
    "statusCode": 500
  }
}
```

**Rate limit**: 60 requests/minute per IP

---

#### GET `/api/public/buildings/:zip/:bin`

**Description**: Fetch details for a single building.

**Parameters**:
```
zip: string (5 digits)
bin: string (building ID)
```

**Response** (200 OK):
```json
{
  "ok": true,
  "data": {
    "bin": "1000001",
    "address": "123 Main St",
    "zip": "10001",
    "score": 28,
    "scoringBreakdown": { ... },
    "violations": [
      {
        "violationId": "123456789",
        "category": "Heat",
        "status": "OPEN",
        "openedDate": "2023-01-15",
        "closedDate": null,
        "isRentImpairing": true,
        "isReissued": false,
        "description": "Inadequate heat"
      }
    ],
    "violationTimeline": {
      "opened": 45,
      "closed": 120,
      "reissued": 9,
      "avgDaysOpen": 2000
    }
  }
}
```

---

### 6.2 Protected Endpoints (Firebase Auth Required)

#### GET `/api/auth/me`

**Description**: Get current user profile.

**Header**:
```
Authorization: Bearer <firebase_jwt>
```

**Response** (200 OK):
```json
{
  "ok": true,
  "data": {
    "uid": "user-123",
    "email": "renter@example.com",
    "tier": "free",
    "createdAt": "2023-01-01T00:00:00Z"
  }
}
```

---

#### POST `/api/users/upgrade`

**Description**: Upgrade user to premium (requires Stripe token).

**Body**:
```json
{
  "stripeToken": "tok_visa"
}
```

**Response** (200 OK):
```json
{
  "ok": true,
  "data": {
    "tier": "premium",
    "subscriptionExpires": "2024-01-01T00:00:00Z"
  }
}
```

---

### 6.3 Premium Endpoints (Auth + Premium Tier Required)

#### GET `/api/premium/landlords/:landlordId`

**Description**: Fetch portfolio for a landlord (all buildings they own/manage).

**Parameters**:
```
landlordId: string (required)
```

**Response** (200 OK):
```json
{
  "ok": true,
  "data": {
    "landlordId": "landlord-123",
    "name": "Smith Properties LLC",
    "portfolioStats": {
      "totalProperties": 47,
      "avgScore": 35,
      "violationCount": 1200,
      "unresponsivePercent": 85
    },
    "properties": [
      {
        "bin": "1000001",
        "address": "123 Main St",
        "zip": "10001",
        "score": 28,
        "violations": 45
      }
    ]
  }
}
```

---

## 7. User Flows

### 7.1 Zip Search (MVP)

```
User opens app
  ↓
[Free tier, no login required]
  ↓
Enters zip code (e.g., 10001)
  ↓
Clicks "Search"
  ↓
Frontend validates format (must be 5 digits)
  ├─ Invalid? Show error, stay on page
  └─ Valid? Continue
  ↓
Frontend calls GET /api/public/buildings/:zip
  ↓
Backend fetches open violations from Socrata
  ├─ No violations? Show "No data" message
  └─ Has violations? Score and sort
  ↓
Frontend displays buildings table:
  - Address
  - Score (worst first, color-coded red/yellow/green)
  - Total violations
  - Rent-impairing violations
  - Avg days open
  ↓
User clicks building row
  ↓
Frontend navigates to building detail page
  ↓
Displays full breakdown:
  - Scoring components (transparency)
  - Violation timeline chart (Chart.js)
  - List of all violations with status
  - Landlord name (when available)
  ↓
User can go back to zip results or search new zip
```

---

### 7.2 Signup & Premium Upgrade (Phase 2)

```
User clicks "Sign Up" or "Try Premium"
  ↓
Firebase Auth dialog (Google or email)
  ↓
User signs in (creates account if new)
  ↓
Frontend stores Firebase JWT in localStorage
  ↓
[If premium signup]
  ↓
User clicks "Upgrade to Premium"
  ↓
Frontend shows Stripe payment form
  ↓
User enters card details
  ↓
Frontend calls POST /api/users/upgrade with Stripe token
  ↓
Backend creates Stripe customer + subscription
  ↓
Backend updates users.tier = 'premium'
  ↓
Frontend shows "Upgrade successful" + redirects to landlord search
```

---

### 7.3 Landlord Portfolio Search (Phase 2, Premium)

```
[User must be logged in + premium tier]
  ↓
User enters landlord name in search
  ↓
Frontend calls GET /api/premium/landlords?search=<name>
  ↓
Backend searches landlord_id field in buildings table
  ↓
Frontend displays results:
  - Landlord name
  - Portfolio stats (total properties, avg score)
  - List of all properties with scores
  ↓
User clicks property
  ↓
Navigates to building detail page (same as zip search)
```

---

## 8. Business Model

### 8.1 Revenue Streams

| Stream | Target | Year 1 | Year 3 |
|--------|--------|--------|--------|
| Premium tier ($4.99/mo) | 500 users → 5k users | $30k → $300k | $1.2M |
| API access (research) | 10 → 50 orgs | $5k | $50k |
| Landlord data reports (B2B) | Tenant advocacy groups | $0 | $50k |

### 8.2 Freemium Model

**Free Tier**:
- Unlimited zip code searches
- Building results + scores
- Violation count & rent-impairing breakdown
- No login required

**Premium Tier** ($4.99/month or $49/year):
- All free features +
- Landlord portfolio search (see all buildings one owner manages)
- Violation export (CSV, PDF)
- Email alerts (new violations, resolved violations)
- Advanced filtering (by category, date, status)
- Neighborhood heatmap

### 8.3 Customer Acquisition

**Phase 1** (Organic):
- Rank for "NYC apartment violations" → "best apartments in [zip]"
- SEO landing pages for each NYC zip code
- Referral widget on building detail pages

**Phase 2** (Paid):
- Google Ads targeting apartment searchers ("apartments + [zip]")
- Social ads (Reddit r/nycapartments, Facebook housing groups)
- Partnerships with tenant advocacy groups

**Phase 3** (B2B):
- API access for research organizations (universities, nonprofits)
- White-label solution for local housing coalitions

---

## 9. Success Metrics

### 9.1 User Metrics

| Metric | Target (Month 3) | Target (Month 12) |
|--------|------------------|-------------------|
| Monthly active users | 5k | 50k |
| Zip searches/month | 10k | 100k |
| Avg session duration | 2 min | 3 min |
| Return rate | 15% | 25% |
| Premium conversion | 0.5% | 2% |

### 9.2 Product Metrics

| Metric | Target |
|--------|--------|
| LCP (Largest Contentful Paint) | < 2.5s |
| P95 API latency | < 500ms |
| Error rate | < 1% |
| Uptime | 99.5% |
| Data freshness | < 24 hours stale |

### 9.3 Business Metrics

| Metric | Target (Month 12) |
|--------|-------------------|
| Paying premium users | 1,000 |
| Monthly recurring revenue (MRR) | $4,990 |
| CAC (Customer Acquisition Cost) | < $10 |
| LTV (Lifetime Value) | > $50 |
| CAC payback | < 2 months |

---

## 10. Technical Constraints & Decisions

### 10.1 Why Composite Scoring Over Single Metric

**Rejected approach**: Show only violation count.

**Problem**: Building with 100 violations + responsive landlord looks worse than building with 20 violations + unresponsive landlord. Misleading.

**Solution**: Composite score factors in responsiveness (avg days stuck, dead-end statuses, reissued violations).

---

### 10.2 Why Violation Status Filter Is Hardcoded

**Question**: Should the API accept `?status=OPEN` as a parameter?

**Answer**: No. Always filter to `OPEN` only.

**Rationale**: 
- Closed violations don't help renters decide between buildings
- Including closed violations would bias historic scores (old buildings accumulate closed violations)
- Keeps API contract simple

---

### 10.3 Why No ORM

**Question**: Should we use Prisma or TypeORM?

**Answer**: Raw `pg` driver.

**Rationale**:
- Fine-grained control over batch queries (fetch violations for 50 buildings in 1 query)
- Scoring algorithm requires complex SQL (grouping, aggregation)
- ORMs add latency for this workload
- Small team = less maintenance burden with raw SQL

---

### 10.4 Why Nightly Batch Sync Instead of Real-Time

**Question**: Should we sync violations as soon as they appear in Socrata?

**Answer**: Nightly batch (12 AM UTC).

**Rationale**:
- Socrata updates are batched daily anyway (~12–24 hour latency)
- Real-time polling would waste API quota
- Renters don't need sub-day freshness
- Batch jobs are simpler to debug and monitor

---

## 11. Known Limitations & Trade-Offs

### 11.1 Landlord Portfolio Identification

**Problem**: Socrata API doesn't reliably expose landlord name/ownership across buildings.

**Status**: In research.

**Impact**: Premium tier (landlord portfolio search) feature delayed.

**Solution paths**:
1. Scrape NYCR (NYC Register) for deed records
2. Use third-party landlord database (landlordology, etc.)
3. Parse free-text landlord field and de-duplicate
4. Manual curated landlord list (starts with top 100)

---

### 11.2 Recurring Same-Issue Factor Not Yet Implemented

**Problem**: Sixth scoring factor requires deduplication (same issue category at same building in same period).

**Status**: Algorithm designed, implementation pending.

**Impact**: Scoring currently uses only 5 factors; sixth factor will add ~5% weight.

---

### 11.3 Geographic Coverage Limited to NYC

**Constraint**: MVP focuses on NYC (largest data availability).

**Future**: Replicate for SF, LA, Chicago (if data exists).

---

## 12. Glossary

| Term | Definition |
|------|-----------|
| **BIN** | Building Identification Number (NYC unique identifier) |
| **Violation** | A complaint filed with NYC HPD that a building violates Housing Maintenance Code |
| **Open Violation** | Violation that has not been resolved / closed |
| **Dead-End Status** | Violation in unproductive status (NOV SENT OUT, NOT COMPLIED WITH, NO ACCESS) |
| **Rent-Impairing** | Violation for issue affecting habitability (heat, mold, vermin, locks, etc.) |
| **Reissued** | Violation for same issue at same address, closed then reopened |
| **Responsiveness** | How quickly a landlord resolves violations once filed (inverse of avg days open) |
| **Composite Score** | Weighted average of 6 factors (0–100, lower = worse landlord) |
| **Socrata** | NYC's open data platform (provides HPD violation dataset) |

---

## 13. Appendix: Sample Data

### Zip 10001 (Chelsea) Example

```json
{
  "zip": "10001",
  "buildings": [
    {
      "bin": "1000001",
      "address": "123 Main St",
      "score": 15,
      "scoringBreakdown": {
        "totalViolations": 30,
        "rentImpairingPercent": 70,
        "avgYearsStuckOpen": 8,
        "deadEndStatusPercent": 90,
        "reissuedPercent": 40,
        "recurringIssue": null
      },
      "violationCount": 78,
      "rentImpairingCount": 55
    },
    {
      "bin": "1000002",
      "address": "456 Park Ave",
      "score": 72,
      "scoringBreakdown": {
        "totalViolations": 8,
        "rentImpairingPercent": 15,
        "avgYearsStuckOpen": 0.5,
        "deadEndStatusPercent": 0,
        "reissuedPercent": 0,
        "recurringIssue": null
      },
      "violationCount": 12,
      "rentImpairingCount": 2
    }
  ]
}
```

---

## References

- [NYC HPD Open Data Portal](https://data.cityofnewyork.us/Housing-Development/Housing-Violations/a2nx-4u46)
- [Housing Maintenance Code (Article 2)](https://codelibrary.amlegal.com/codes/newyork/latest/nyhadministrativecode/title-27)
- [HPD Violation Status Codes](https://data.cityofnewyork.us/api/views/wvxf-dwi5/files/f2e3e809-9f9a-4d7f-88ff-c58c13f10d42)
- [Rent Impairing Violations (NY Law)](https://www.nycbar.org/legal-research-and-services/publications-and-resources/lessons-from-the-law/protecting-tenants/rent-abatement-for-uninhabitable-premises)
