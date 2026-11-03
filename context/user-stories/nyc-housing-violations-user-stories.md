# User Stories - NYC Building Violations App (MVP)

## Epic 1: Search & Discover Violations by Neighborhood

### US-1: Search by Zip Code

**As a** renter looking to move or evaluate a neighborhood  
**I want to** enter a zip code and see violation data for that area  
**So that** I can understand the housing quality of neighborhoods I'm considering

**Acceptance Criteria:**

- User can input a zip code (11106 or similar)
- App filters to open violations only by default
- Results load within 2 seconds
- Invalid zip codes show an error message

**Tasks:**

- [ ] Build zip code input component
- [ ] Create `/api/buildings?zip=11106` endpoint
- [ ] Handle invalid/non-existent zip codes

---

### US-2: View Zip Code Summary Stats

**As a** neighborhood researcher  
**I want to** see an overview of violation statistics for a zip code  
**So that** I can quickly gauge area-wide housing quality

**Acceptance Criteria:**

- Display total violations in zip code
- Display total buildings with violations
- Display average building rating for zip
- Show worst building in the zip

**Tasks:**

- [ ] Calculate zip-level aggregations in database
- [ ] Display summary card at top of results
- [ ] Format numbers clearly (e.g., "1,247 violations")

---

## Epic 2: Building Details & Ratings

### US-3: View Top 10 Worst Buildings in Zip

**As a** someone moving to a neighborhood  
**I want to** see the 10 buildings with the most violations  
**So that** I can avoid the worst properties

**Acceptance Criteria:**

- List shows top 10 buildings ranked by rating (or violation count)
- Each building shows: address, violation count, rating (1-5 stars or 0-100)
- Buildings are sortable by violation count, rating, or recency
- List is limited to open violations only

**Tasks:**

- [ ] Query top 10 buildings from database
- [ ] Create building card component
- [ ] Implement rating display (stars/percentage)
- [ ] Add sort buttons

---

### US-4: Expand Building to See Violation Details

**As a** renter concerned about a specific building  
**I want to** expand a building card to see individual violations  
**So that** I can understand what specific problems exist (heat, plumbing, etc.)

**Acceptance Criteria:**

- Clicking a building reveals a list of violations
- Each violation shows: date, description, status, how long it's been open
- List is scrollable if many violations
- Can collapse back to summary view

**Tasks:**

- [ ] Create expandable building card UI
- [ ] Build `/api/violations?buildingId=417759` endpoint
- [ ] Display violation date, type, days open
- [ ] Calculate days open (today - inspection date)

---

### US-5: Building Gets a Rating Score

**As a** someone browsing buildings  
**I want to** see a single rating (1-5 stars or 0-100) per building  
**So that** I can quickly compare buildings without reading all details

**Acceptance Criteria:**

- Rating appears on every building card
- Rating is based on: violation count, reissuance rate, age of violations, rent-impairing violations
- Rating scale is consistent (1-5 stars preferred, or 0-100)
- Tooltip explains what rating factors include (optional)

**Tasks:**

- [ ] Define rating formula based on data insights
  - Reissuance count (high = bad)
  - Average days open (high = bad)
  - Rent-impairing violation ratio (high = bad)
- [ ] Implement calculation in loader script
- [ ] Store rating in buildings table
- [ ] Display in UI with visual cue (color, stars, etc.)

---

## Epic 3: Geographic Visualization

### US-6: View Heatmap of Violations Across Zip

**As a** someone exploring a neighborhood  
**I want to** see a geographic heatmap showing where violations are concentrated  
**So that** I can avoid the worst blocks/areas and find safer spots

**Acceptance Criteria:**

- Heatmap renders on a map (Mapbox or Leaflet)
- Higher intensity = more/worse violations
- Can click a point to see building details
- Heatmap zooms to zip code bounds on load
- Load time under 2 seconds for 10k+ points

**Tasks:**

- [ ] Choose map library (Mapbox GL or Leaflet)
- [ ] Create `/api/heatmap?zip=11106` endpoint
- [ ] Calculate intensity per violation (weight by rating or age)
- [ ] Build map component
- [ ] Add zoom/pan/click interactions

---

## Epic 4: Data Filtering (Optional for MVP, but nice to have)

### US-7: Filter by Violation Type

**As a** someone with specific concerns  
**I want to** filter violations to show only rent-impairing ones (heat, hot water, safety)  
**So that** I can focus on issues that directly affect my living conditions

**Acceptance Criteria:**

- Toggle/checkbox to filter rent-impairing violations
- Building ratings update to reflect filtered violations
- Can combine with zip code search

**Tasks:**

- [ ] Add filter UI component
- [ ] Update API queries to accept `?rentImpairing=true`
- [ ] Recalculate ratings based on filtered data
- [ ] Update heatmap intensity for filtered view

---

### US-8: Filter by Violation Age

**As a** someone who wants to know current vs. historical issues  
**I want to** filter violations to show only those opened in the last X years  
**So that** I can see which buildings have active vs. old problems

**Acceptance Criteria:**

- Dropdown to select time range (Last 1 year, 5 years, all)
- Building list updates dynamically
- Ratings adjust based on filtered data

**Tasks:**

- [ ] Add date range filter component
- [ ] Update API to accept `?yearsOpen=5` parameter
- [ ] Recalculate building metrics

---

## Epic 5: User Experience

### US-9: Mobile-Responsive Design

**As a** someone searching on their phone while apartment hunting  
**I want to** use the app comfortably on mobile  
**So that** I can check buildings while viewing properties in person

**Acceptance Criteria:**

- All UI elements responsive to mobile width (< 600px)
- Heatmap scales appropriately on mobile
- Touch-friendly buttons and inputs
- No horizontal scrolling needed

**Tasks:**

- [ ] Design mobile-first layout
- [ ] Test on iPhone/Android viewports
- [ ] Optimize map rendering for mobile

---

### US-10: Clear Empty States & Error Handling

**As a** new user  
**I want to** understand what to do when the app is empty  
**I want to** see helpful error messages if something breaks  
**So that** I'm not confused and can recover quickly

**Acceptance Criteria:**

- Empty zip code input shows placeholder text
- Invalid zip code shows clear error
- API errors display user-friendly messages
- Loading states are visible

**Tasks:**

- [ ] Create empty state UI
- [ ] Add error boundary component
- [ ] Display loading spinners during API calls
- [ ] Test with bad/missing data

---

## Not in MVP (Future Phases)

- US-11: Landlord information & contact details
- US-12: Tenant review/complaint system
- US-13: Historical trend graphs
- US-14: Compare two zip codes side-by-side
- US-15: Save favorite buildings/neighborhoods
- US-16: Email alerts for new violations

---

## Notes

- MVP target: US-1 through US-6 (core discovery + heatmap)
- US-7 & US-8 nice-to-have if time allows
- US-9 & US-10 essential for polish
- Landlord features (US-11) reserved for Phase 2
