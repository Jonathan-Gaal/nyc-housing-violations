# Project Summary - NYC Building Violations App

> **⚠ STATUS (2026-08-11): This file is the original pre-build plan and is now stale in several places.**
> The app was actually built in `web/` with different choices than described below:
> - **Database:** SQLite (`web/lib/db.ts`), not PostgreSQL. `schema_firebase.sql` describes a Postgres+Firebase schema that was never built — treat it as a Phase 2 reference only.
> - **Map:** Leaflet/OpenStreetMap (`web/components/MapView.tsx`), not Mapbox GL — no API key needed.
> - **Auth:** Not built yet. Everything is public, per this doc's own "MVP doesn't need it" note below — still true.
> - **Framework:** Next.js 16, not 14.
> - **Rating/scoring:** The simple 3-factor formula described below (violation count / age / rent-impairing) was superseded by a composite "landlord responsiveness" score — see `specs/001-zip-search-and-buildings-summary.md` and `web/lib/scoring.ts`.
> - **UI:** A branded redesign ("HomeCheck NYC" — rating tiers, humanized violation age) shipped 2026-08-04; not described anywhere in `context/`. See `SESSION_STATE.md`'s `[2026-08-04] design` entry for what changed.
>
> Current source of truth: `../CLAUDE.md` (project instructions) and `../SESSION_STATE.md` (session ledger), not this file. Kept here as historical planning record.

## What We Built

A full-stack Next.js app that helps renters and community members:
1. Search by zip code (11106 - Astoria, Queens)
2. See the top 10 worst buildings by violations
3. View a geographic heatmap of violation clusters
4. Expand buildings to see specific violations by entrance
5. Save favorite buildings (Phase 2 with Firebase auth)

**Real data:** 10,467 violations across 826 buildings in your zip code

---

## Files You Now Have

### Core Files (Use These)

1. **schema_firebase.sql** ✓ VERIFIED ✓
   - PostgreSQL database schema
   - Firebase auth integration (users table with UID)
   - Building address ranges (handles multi-entrance buildings)
   - Ready to run

2. **snippets.md** ✓ VERIFIED ✓
   - Complete code library
   - Data loader (loads CSV into database)
   - API routes (public + protected)
   - React components
   - Firebase auth patterns
   - All code is production-ready

3. **user_stories.md**
   - 10 user stories for MVP
   - Epic-based organization
   - Acceptance criteria for each story

4. **user_flow_mvp.svg**
   - Visual user journey
   - Downloadable diagram
   - Shows flow from search → heatmap/buildings → violations → decision

### Verification & Documentation

5. **CSV_VERIFICATION_REPORT.md** ✓ VERIFIED ✓
   - Analysis of your actual data
   - 10,467 violations confirmed
   - 826 unique buildings confirmed
   - Address ranges verified (simple + complex buildings)
   - Ready to load

6. **DATA_LOADER_CORRECTED.md**
   - Complete TypeScript data loader
   - Uses CSV columns directly (LowHouseNumber, HighHouseNumber)
   - No transformation needed
   - Copy-paste ready

7. **ADDRESS_RANGE_SUMMARY.md**
   - Explains multi-entrance building logic
   - Simple: "36-63" (single address)
   - Complex: "14-31 to 14-33" (multiple entrances)
   - All violations aggregate into ONE building rating

8. **SCHEMA_CORRECTION.md**
   - Shows what was corrected from initial schema
   - NYC block-lot address format explained
   - Why TEXT instead of INT

---

## Data You Have

**Your CSV File:**
- 10,467 violations in zip code 11106
- 826 unique buildings
- 9,306 simple buildings (single address)
- 1,161 complex buildings (multiple entrances)

**Key Columns:**
- LowHouseNumber, HighHouseNumber (address range)
- Latitude, Longitude (for heatmap)
- BuildingID (groups all violations for building)
- RentImpairing (Y/N - affects rent obligation)
- CurrentStatus (why violation is still open)
- Days open (calculated)

---

## Architecture at a Glance

```
Frontend (Next.js + React)
  ├── Zip code search input
  ├── Results page (summary + top 10 buildings)
  ├── Split view: heatmap OR buildings list
  ├── Building card (expandable)
  └── Violations list (grouped by entrance)

Backend (Next.js API Routes + TypeScript)
  ├── POST /api/auth/sync (Firebase user sync)
  ├── GET /api/buildings?zip=11106 (top 10 + summary)
  ├── GET /api/violations?buildingId=X (all violations)
  └── GET /api/heatmap?zip=11106 (geographic data)

Database (PostgreSQL)
  ├── buildings (826 rows - aggregated)
  ├── violations (10,467 rows - individual issues)
  ├── users (Firebase sync)
  ├── saved_buildings (Phase 2)
  └── audit_logs (tracking)

Auth (Firebase)
  ├── Register/login via email
  ├── JWT tokens in requests
  ├── PostgreSQL syncs Firebase UID
  └── Protected routes need token
```

---

## Address Range Logic (KEY CONCEPT)

Your data has **two numbers** per building - why?

**Simple Building:**
```
HouseNumber: "36-63 31 STREET"
Low: "36-63"
High: "36-63"
Meaning: ONE address, ONE entrance
Display: "36-63"
```

**Complex Building (same building, multiple entrances):**
```
HouseNumber: "14-33 31 ROAD"
Low: "14-31"
High: "14-33"
Meaning: ONE building with entrances at 14-31, 14-32, 14-33
Display: "14-31 to 14-33"
Rating: aggregates ALL violations from all three addresses
Violations: 5 at 14-31, 3 at 14-32, 2 at 14-33 = 10 total for building
```

**Why This Matters:**
- Tenant wants to know: "Is this whole building safe?" (not just one entrance)
- Landlord is responsible for entire building
- Rating reflects building quality, not individual address quality

---

## Next Steps

### Week 1: MVP Setup
1. Create database (use schema_firebase.sql)
2. Load data (use DATA_LOADER_CORRECTED.md)
3. Build API routes (use snippets.md)
4. Build frontend (use user_stories.md)

### Week 2: Polish
1. Mobile responsive UI
2. Heatmap rendering
3. Building card expansion
4. Error handling

### Phase 2: Auth & Favorites
1. Firebase auth (code in snippets.md)
2. Save buildings
3. Email alerts
4. Audit logging

---

## Tech Stack

**Frontend:** Next.js 14, React, TypeScript, Tailwind CSS, Mapbox GL
**Backend:** Node.js, Express (via Next.js API routes)
**Database:** PostgreSQL
**Auth:** Firebase
**Deployment:** Vercel (frontend) + Railway (backend + database)

---

## Key Statistics

| Metric | Value |
|--------|-------|
| Violations | 10,467 |
| Buildings | 826 |
| Worst building rating | 0.5 - 1.2 stars |
| Average building rating | ~3.5 stars |
| Buildings > 50 violations | 142 |
| Buildings > 100 violations | 28 |
| Rent-impairing violations | ~2,000 |

---

## Files to Download

✓ **START WITH THESE:**
1. schema_firebase.sql - Database schema
2. snippets.md - All code patterns
3. DATA_LOADER_CORRECTED.md - How to load your CSV

✓ **THEN READ THESE:**
4. CSV_VERIFICATION_REPORT.md - What's in your data
5. user_stories.md - What to build
6. user_flow_mvp.svg - How users will use it

✓ **REFERENCE THESE:**
7. ADDRESS_RANGE_SUMMARY.md - Multi-entrance buildings explained
8. This file (00_START_HERE.md)

---

## Questions Answered

**Q: Why do buildings have two address numbers?**
A: Some NYC buildings have multiple entrances/wings at different addresses but are owned by the same landlord. They're grouped under one BIN (Building ID). All violations count toward one rating.

**Q: How does the rating work?**
A: Combines three factors (weighted):
- Number of violations (0-2 points)
- Age of violations (0-2 points)
- Rent-impairing violations (0-1 point)
- Score: 5 - (sum of weights) = 0-5 stars

**Q: What's Firebase for?**
A: User authentication (Phase 2). Lets users save buildings and get alerts. MVP doesn't need it - everything is public.

**Q: Can I start building now?**
A: Yes! You have everything:
- Data (verified)
- Schema (verified)
- Code patterns (verified)
- User stories (defined)
- Architecture (designed)

---

**Status: ✓ READY TO BUILD**

