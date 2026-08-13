# CSV Verification Report

> **⚠ Correction (2026-08-11):** This report assumed the CSV was pure zip 11106. It isn't — it also contains a handful of rows for 11429 and 10009 (confirmed 2026-08-04 during build, `SESSION_STATE.md`). The stats below (10,467 violations / 826 buildings) are totals across *all* zips in the file, not 11106 alone (11106 alone is 818 buildings / ~10,283 violations as of the latest load). `web/lib/loadIntoDb.ts` and `web/lib/queries.ts` filter by `postcode` defensively rather than trusting the file to be single-zip — don't assume file scope in future data work either.

## File Analyzed
**Housing_Maintenance_Code_Violations_20260803.csv**

## Data Summary

| Metric | Value |
|--------|-------|
| Total Violations | 10,467 |
| Unique Buildings | 826 |
| Simple Buildings (single address) | 9,306 violations |
| Complex Buildings (multi-entrance) | 1,161 violations |
| Zip Code | 11106 (Astoria, Queens) |

## Address Format Discovered

**NYC uses block-lot format:** `XX-YY` where XX = block, YY = lot

Examples from your data:
- "36-63" = Block 36, Lot 63 (single address)
- "14-31" to "14-33" = Range from Block 14 Lot 31 to Block 14 Lot 33

## CSV Columns Verified

✓ **ViolationID** - Unique violation identifier  
✓ **BuildingID** - Building Identification (matches BIN)  
✓ **LowHouseNumber** - TEXT, in "XX-YY" format (e.g., "14-31")  
✓ **HighHouseNumber** - TEXT, in "XX-YY" format (e.g., "14-33")  
✓ **StreetName** - e.g., "31 ROAD", "36 AVENUE"  
✓ **Latitude** - Geographic coordinate  
✓ **Longitude** - Geographic coordinate  
✓ **InspectionDate** - Date violation was found  
✓ **CurrentStatus** - Status (NOT COMPLIED WITH, SECOND NO ACCESS, etc)  
✓ **ViolationStatus** - Open/Closed  
✓ **RentImpairing** - Y/N (affects rent obligation)  
✓ **NOVDescription** - What's wrong (Heat, Plumbing, etc)  
✓ **NovType** - Category  
✓ **BIN** - Building Identification Number  
✓ **BBL** - Borough-Block-Lot  

## Key Findings

### 1. Simple Buildings
```
Sample:
  HouseNumber: "36-63 31 STREET"
  LowHouseNumber: "36-63"
  HighHouseNumber: "36-63"
  Display: "36-63"
  Interpretation: ONE address, ONE entrance
```

### 2. Complex Buildings
```
Sample:
  HouseNumber: "14-33 31 ROAD"
  LowHouseNumber: "14-31"
  HighHouseNumber: "14-33"
  Display: "14-31 to 14-33"
  Interpretation: Multiple addresses (14-31, 14-32, 14-33), same building
```

### 3. Aggregation Rule
All violations across all addresses for a building aggregate into ONE building record:
- Building ID = BIN (stays constant)
- Violation count = total violations across ALL addresses
- Rating = based on ALL violations from ALL addresses
- Both entrances/wings treated as ONE building

## Schema Implications

**buildings table columns:**
```sql
house_number_low TEXT        -- "36-63" or "14-31" (CSV LowHouseNumber)
house_number_high TEXT       -- "36-63" or "14-33" (CSV HighHouseNumber)
house_number_display TEXT    -- Display: "36-63" or "14-31 to 14-33"
```

**No INT conversion needed** - Use CSV values as-is

## Data Loader Strategy

1. Read each violation from CSV
2. Extract: `BuildingID`, `LowHouseNumber`, `HighHouseNumber`
3. Group violations by `BuildingID` (BIN)
4. For each building:
   - Take first violation's LowHouseNumber/HighHouseNumber
   - Aggregate all violations for that BuildingID
   - Calculate rating, violation_count, etc.
   - Generate display: low === high ? low : `${low} to ${high}`

## Verification Checklist

- [x] CSV file contains LowHouseNumber column
- [x] CSV file contains HighHouseNumber column
- [x] Address format is TEXT, not numeric
- [x] NYC block-lot format confirmed ("XX-YY")
- [x] Simple buildings have low === high
- [x] Complex buildings have low ≠ high
- [x] Latitude/Longitude present for all records
- [x] BuildingID (BIN) properly groups violations
- [x] Total of 10,467 violations in 11106 zip

## Conclusion

**✓ CSV structure matches schema design**  
**✓ Address range logic is correct**  
**✓ Ready to load data into PostgreSQL**  
**✓ No additional data transformation needed**

The CSV already has the building address ranges built in via LowHouseNumber/HighHouseNumber columns. The data loader simply needs to:
1. Group violations by BuildingID
2. Use LowHouseNumber/HighHouseNumber as-is (TEXT format)
3. Aggregate violation stats across all addresses
4. Store in `buildings` table with aggregated metrics

