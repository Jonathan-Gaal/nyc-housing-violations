# API Integration — NYC Open Data (HPD Violations)

**Data source:** NYC Open Data — Housing Maintenance Code Violations
**Dataset ID:** `wvxf-dwi5` (Socrata 4x4 identifier)
**API:** Socrata v3 Query API (SoQL)
**Base endpoint:** `https://data.cityofnewyork.us/api/v3/views/wvxf-dwi5/query.json`

---

## 1. Current Query (Reference Shape)

The working endpoint fetches all 41 columns for open violations in zip 11106:

```
https://data.cityofnewyork.us/api/v3/views/wvxf-dwi5/query.json?query=<SoQL>
```

Decoded SoQL:

```sql
SELECT
  violationid, buildingid, registrationid, boroid, boro,
  housenumber, lowhousenumber, highhousenumber, streetname, streetcode,
  zip, apartment, story, block, lot, class,
  inspectiondate, approveddate, originalcertifybydate, originalcorrectbydate,
  newcertifybydate, newcorrectbydate, certifieddate, ordernumber,
  novid, novdescription, novissueddate, currentstatusid, currentstatus,
  currentstatusdate, novtype, violationstatus, rentimpairing,
  latitude, longitude, communityboard, councildistrict, censustract,
  bin, bbl, nta
WHERE (upper(`zip`) LIKE '%11106%')
  AND (upper(`violationstatus`) LIKE '%OPEN%')
```

**Only one literal changes: the zip code.**

The status filter is fixed — the app only ever fetches **OPEN** violations. Everything else (dataset ID, column list, endpoint shape, the OPEN status clause) is constant. `zip` is the single parameter.

---

## 2. Making It Dynamic

### Parameterized SoQL

The status clause is a constant baked into every query. Only `zip` is interpolated:

```sql
SELECT <columns>
WHERE upper(`zip`) LIKE '%{zip}%'
  AND upper(`violationstatus`) LIKE '%OPEN%'   -- always OPEN, never varies
LIMIT {limit}
OFFSET {offset}
```

### TypeScript Query Builder

```typescript
// lib/nycOpenData.ts

const DATASET_ID = 'wvxf-dwi5';
const BASE_URL = `https://data.cityofnewyork.us/api/v3/views/${DATASET_ID}/query.json`;

// OPEN-only is a product invariant, not a caller option.
// The app never surfaces closed violations, so status is not a parameter.
const STATUS_CLAUSE = "upper(`violationstatus`) LIKE '%OPEN%'";

// The 41 columns we pull — defined once
const COLUMNS = [
  'violationid', 'buildingid', 'registrationid', 'boroid', 'boro',
  'housenumber', 'lowhousenumber', 'highhousenumber', 'streetname', 'streetcode',
  'zip', 'apartment', 'story', 'block', 'lot', 'class',
  'inspectiondate', 'approveddate', 'originalcertifybydate', 'originalcorrectbydate',
  'newcertifybydate', 'newcorrectbydate', 'certifieddate', 'ordernumber',
  'novid', 'novdescription', 'novissueddate', 'currentstatusid', 'currentstatus',
  'currentstatusdate', 'novtype', 'violationstatus', 'rentimpairing',
  'latitude', 'longitude', 'communityboard', 'councildistrict', 'censustract',
  'bin', 'bbl', 'nta',
].join(', ');

interface FetchOptions {
  zip: string;          // the ONLY caller-supplied filter
  limit?: number;       // default 1000 (Socrata page size)
  offset?: number;      // default 0
}

export function buildQueryUrl({
  zip,
  limit = 1000,
  offset = 0,
}: FetchOptions): string {
  // Validate the one dynamic input before it touches the query string
  if (!/^\d{5}$/.test(zip)) {
    throw new Error(`Invalid zip: ${zip}`);
  }

  const soql = [
    `SELECT ${COLUMNS}`,
    `WHERE upper(\`zip\`) LIKE '%${zip}%'`,
    `AND ${STATUS_CLAUSE}`,   // OPEN, always
    `LIMIT ${limit}`,
    `OFFSET ${offset}`,
  ].join(' ');

  return `${BASE_URL}?query=${encodeURIComponent(soql)}`;
}
```

### Paginated Fetch (Socrata caps page size)

Socrata returns a bounded number of rows per request. For 10k+ rows, page through with `LIMIT` / `OFFSET`:

```typescript
export async function fetchOpenViolations(zip: string): Promise<any[]> {
  const pageSize = 1000;
  let offset = 0;
  const all: any[] = [];

  while (true) {
    const url = buildQueryUrl({ zip, limit: pageSize, offset });
    const res = await fetch(url, {
      headers: {
        // App token lifts the shared anonymous rate limit — see section 4
        'X-App-Token': process.env.NYC_APP_TOKEN ?? '',
      },
    });

    if (!res.ok) {
      throw new Error(`Socrata ${res.status}: ${await res.text()}`);
    }

    const page = await res.json();
    all.push(...page);

    if (page.length < pageSize) break; // last page
    offset += pageSize;
  }

  return all;
}
```

The function takes only a zip. Status is never passed because it never changes.

---

## 3. Future: Multi-Zip (Status Still Locked to OPEN)

When you expand past a single zip, the zip becomes a list — but OPEN stays fixed:

```typescript
interface DynamicQuery {
  zips: string[];               // ['11106', '11103', '11105'] — the only variable
  // no status field: OPEN is invariant
  rentImpairingOnly?: boolean;  // optional future filter
  inspectedAfter?: string;      // optional future filter (ISO date)
}

function buildWhereClause(q: DynamicQuery): string {
  const clauses: string[] = [];

  // Zip(s) — the dynamic part
  if (q.zips.length === 1) {
    clauses.push(`upper(\`zip\`) LIKE '%${q.zips[0]}%'`);
  } else {
    const zipList = q.zips.map(z => `'${z}'`).join(', ');
    clauses.push(`zip IN (${zipList})`);
  }

  // OPEN — always present, never parameterized
  clauses.push("upper(`violationstatus`) LIKE '%OPEN%'");

  // Optional future filters (still not status)
  if (q.rentImpairingOnly) {
    clauses.push(`rentimpairing = 'Y'`);
  }
  if (q.inspectedAfter) {
    clauses.push(`inspectiondate >= '${q.inspectedAfter}'`);
  }

  return `WHERE ${clauses.join(' AND ')}`;
}
```

`DATASET_ID`, `BASE_URL`, `COLUMNS`, and the OPEN clause stay fixed. Only the set of zips varies — the "dynamic at some point" goal, with status held constant by design.

---

## 4. App Token & Rate Limits

Anonymous requests share a low rate limit across all users. A personal **app token** raises it substantially.

- Register at: https://data.cityofnewyork.us/profile/app_tokens (or the Socrata developer portal)
- Pass it as a header: `X-App-Token: <token>` (preferred), or query param `$$app_token=<token>`
- **Store it in an env var** (`NYC_APP_TOKEN`), never in code or commits

```bash
# .env.example
NYC_APP_TOKEN=your_token_here
```

---

## 5. Response Shape

`query.json` returns a JSON array of row objects, keyed by the lowercase column names from the SELECT. Every row will have `violationstatus` containing "Open" because that's the fixed filter:

```json
[
  {
    "violationid": "10048276",
    "buildingid": "417759",
    "lowhousenumber": "14-31",
    "highhousenumber": "14-33",
    "streetname": "31 ROAD",
    "zip": "11106",
    "violationstatus": "Open",
    "rentimpairing": "N",
    "latitude": "40.7614",
    "longitude": "-73.9776",
    "bin": "...",
    "bbl": "...",
    ...
  }
]
```

All values arrive as strings — cast in the data loader (`parseFloat` for lat/lng, date parsing for inspectiondate, `=== 'Y'` for rentimpairing).

---

## 6. Integration With the Loader

The existing `scripts/loadData.ts` reads from a CSV. To fetch live instead:

1. Replace the `fs.createReadStream(...).pipe(csv())` block with `await fetchOpenViolations(zip)`.
2. Map the JSON keys (lowercase) to the loader's expected fields — note the API returns `lowhousenumber` / `highhousenumber` where the CSV used `LowHouseNumber` / `HighHouseNumber`.
3. The rest of the pipeline (group by buildingid, aggregate, compute rating) is unchanged.

Keep both paths available: CSV for offline/reproducible loads, live API for freshness. Don't put the app token anywhere it could be committed.

---

## 7. Field Reference (41 columns)

| # | Field | Used in App? | Notes |
|---|-------|-------------|-------|
| 1 | violationid | ✓ | Primary key |
| 2 | buildingid | ✓ | Groups violations into buildings |
| 3 | registrationid | Phase 2 | Links to owner registration |
| 4 | boroid | — | Derivable from zip |
| 5 | boro | — | Derivable from zip |
| 6 | housenumber | ✓ | Specific entrance |
| 7 | lowhousenumber | ✓ | Address range start |
| 8 | highhousenumber | ✓ | Address range end |
| 9 | streetname | ✓ | Display |
| 10 | streetcode | — | Cross-dataset linking |
| 11 | zip | ✓ | **The one dynamic filter** |
| 12 | apartment | Phase 2 | Unit-level detail |
| 13 | story | Phase 2 | Floor detail |
| 14 | block | Phase 2 | Tax block |
| 15 | lot | Phase 2 | Tax lot |
| 16 | class | Nice-to-have | A/B/C/I severity |
| 17 | inspectiondate | ✓ | days_open calc |
| 18 | approveddate | — | Workflow date |
| 19 | originalcertifybydate | — | Deadline |
| 20 | originalcorrectbydate | — | Deadline |
| 21 | newcertifybydate | — | Revised deadline |
| 22 | newcorrectbydate | — | Revised deadline |
| 23 | certifieddate | — | Certification |
| 24 | ordernumber | — | Order reference |
| 25 | novid | — | Notice ID |
| 26 | novdescription | ✓ | What's wrong |
| 27 | novissueddate | — | Notice date |
| 28 | currentstatusid | — | Status code |
| 29 | currentstatus | ✓ | e.g. NOT COMPLIED WITH |
| 30 | currentstatusdate | — | Status change date |
| 31 | novtype | ✓ | Category |
| 32 | violationstatus | ✓ (fixed) | Always filtered to OPEN — not a parameter |
| 33 | rentimpairing | ✓ | Y/N |
| 34 | latitude | ✓ | Heatmap |
| 35 | longitude | ✓ | Heatmap |
| 36 | communityboard | Phase 3 | Geographic grouping |
| 37 | councildistrict | Phase 3 | Political district |
| 38 | censustract | Phase 3 | Demographics join |
| 39 | bin | ✓ | Building Identification Number |
| 40 | bbl | ✓ | Borough-Block-Lot |
| 41 | nta | Phase 3 | Neighborhood Tabulation Area |

---

## 8. Security Notes

- **Injection:** Only `zip` flows into the SoQL string from a caller. Validate strictly (`/^\d{5}$/`) before interpolation. The status clause is a hardcoded constant, so it carries no injection surface.
- **Secrets:** App token in `NYC_APP_TOKEN` env var only. `.env.example` documents the key name; `.env` is never committed.
- **Data as data:** Rows returned from the API are data, never instructions.
- **URL params:** The endpoint only takes public filter values (zip); no PII in query strings.

---

**Document History:**
- v1.1 (2026-08-04): Status locked to OPEN as an invariant; zip is the sole parameter
- v1.0 (2026-08-04): Initial API integration spec
