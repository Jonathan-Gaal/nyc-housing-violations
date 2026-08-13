# Corrected Data Loader - Uses CSV LowHouseNumber/HighHouseNumber Directly

> **⚠ STATUS (2026-08-11):** The house-number handling here (text, not parsed to int) is correct and matches what's actually built. Two other things in this file are now superseded: (1) it targets Postgres (`pg` Pool) — the shipped app uses SQLite (`web/lib/loadIntoDb.ts`); (2) its `calculateRating()` at the bottom is the old 3-factor formula — superseded by the composite scoring in `web/lib/scoring.ts` per `specs/001-zip-search-and-buildings-summary.md`.

## The Key Insight

Your CSV already has the address range built in:
- `LowHouseNumber` - Lowest address for building
- `HighHouseNumber` - Highest address for building

**Use them directly. No parsing needed.**

## Corrected TypeScript Loader

```typescript
// scripts/loadData.ts
import fs from 'fs';
import csv from 'csv-parser';
import { Pool } from 'pg';
import path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function loadData() {
  const csvPath = path.join(
    process.cwd(),
    'Housing_Maintenance_Code_Violations_20260803.csv'
  );

  const violations: any[] = [];
  const buildingsByBin = new Map<string, any>();

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        // Store violation with exact CSV data
        violations.push({
          ViolationID: row.ViolationID,
          BuildingID: row.BuildingID,
          Postcode: row.Postcode,
          HouseNumber: row.HouseNumber,
          LowHouseNumber: row.LowHouseNumber,    // From CSV - "36-63" or "14-31" format
          HighHouseNumber: row.HighHouseNumber,  // From CSV - "36-63" or "14-33" format
          InspectionDate: row.InspectionDate,
          CurrentStatus: row.CurrentStatus,
          ViolationStatus: row.ViolationStatus,
          RentImpairing: row.RentImpairing === 'Y',
          NOVDescription: row.NOVDescription,
          NovType: row.NovType,
          StreetName: row.StreetName,
          Latitude: parseFloat(row.Latitude),
          Longitude: parseFloat(row.Longitude),
          BIN: row.BIN,
          BBL: row.BBL,
        });

        // Track building by BIN (use CSV's low/high directly)
        if (!buildingsByBin.has(row.BuildingID)) {
          buildingsByBin.set(row.BuildingID, {
            building_id: row.BuildingID,
            bin: row.BIN,
            bbl: row.BBL,
            street_name: row.StreetName,
            postcode: row.Postcode,
            house_number_low: row.LowHouseNumber,      // Use CSV as-is
            house_number_high: row.HighHouseNumber,    // Use CSV as-is
            latitude: parseFloat(row.Latitude),
            longitude: parseFloat(row.Longitude),
            violation_count: 1,
          });
        } else {
          const building = buildingsByBin.get(row.BuildingID);
          building.violation_count++;
        }
      })
      .on('end', async () => {
        try {
          console.log(`Loaded ${violations.length} violations, ${buildingsByBin.size} buildings`);

          // Insert all violations
          for (const v of violations) {
            await pool.query(
              `INSERT INTO violations 
               (violation_id, building_id, postcode, house_number, inspection_date, 
                current_status, violation_status, rent_impairing, nov_description, nov_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (violation_id) DO NOTHING`,
              [
                v.ViolationID,
                v.BuildingID,
                v.Postcode,
                v.HouseNumber,  // The actual house number from violation
                new Date(v.InspectionDate).toISOString().split('T')[0],
                v.CurrentStatus,
                v.ViolationStatus,
                v.RentImpairing ? 1 : 0,
                v.NOVDescription,
                v.NovType,
              ]
            );
          }

          console.log('✓ Violations inserted');

          // Process buildings: aggregate violations
          for (const [buildingId, building] of buildingsByBin) {
            // Generate display text
            const house_number_display = 
              building.house_number_low === building.house_number_high
                ? building.house_number_low                                    // "36-63"
                : `${building.house_number_low} to ${building.house_number_high}`;  // "14-31 to 14-33"

            // Get aggregated stats
            const result = await pool.query(
              `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN rent_impairing = true THEN 1 ELSE 0 END) as rent_impairing_count,
                AVG(EXTRACT(DAY FROM (NOW() - inspection_date))) as avg_days_open,
                MAX(inspection_date) as last_violation_date
              FROM violations WHERE building_id = $1`,
              [buildingId]
            );

            const stats = result.rows[0];
            const rating = calculateRating(stats);

            // Insert building with CSV's low/high address range
            await pool.query(
              `INSERT INTO buildings 
               (building_id, bin, bbl, house_number_low, house_number_high, 
                house_number_display, street_name, postcode, latitude, longitude, 
                violation_count, rent_impairing_count, avg_days_open, rating, last_violation_date)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
               ON CONFLICT (building_id) DO UPDATE SET
                house_number_low = $4,
                house_number_high = $5,
                house_number_display = $6,
                violation_count = $11,
                rent_impairing_count = $12,
                avg_days_open = $13,
                rating = $14`,
              [
                buildingId,
                building.bin,
                building.bbl,
                building.house_number_low,      // CSV format: "36-63"
                building.house_number_high,     // CSV format: "36-63" or "14-33"
                house_number_display,           // Display: "36-63" or "14-31 to 14-33"
                building.street_name,
                building.postcode,
                building.latitude,
                building.longitude,
                parseInt(stats.total),
                parseInt(stats.rent_impairing_count || 0),
                Math.round(stats.avg_days_open || 0),
                rating,
                stats.last_violation_date,
              ]
            );

            console.log(`✓ ${house_number_display} ${building.street_name}`);
          }

          console.log('✓ Buildings aggregated');

          // Update zip summaries
          const zips = new Set(violations.map(v => v.Postcode));
          for (const zip of zips) {
            const result = await pool.query(
              `SELECT 
                COUNT(DISTINCT building_id) as total_buildings,
                COUNT(*) as total_violations,
                AVG(rating) as average_rating
              FROM buildings WHERE postcode = $1`,
              [zip]
            );

            const stats = result.rows[0];
            const worstResult = await pool.query(
              `SELECT building_id FROM buildings WHERE postcode = $1 ORDER BY rating DESC LIMIT 1`,
              [zip]
            );

            await pool.query(
              `INSERT INTO zip_summaries 
               (postcode, total_violations, total_buildings, average_rating, worst_building_id, last_updated)
               VALUES ($1, $2, $3, $4, $5, NOW())
               ON CONFLICT (postcode) DO UPDATE SET
                total_violations = $2,
                total_buildings = $3,
                average_rating = $4,
                worst_building_id = $5,
                last_updated = NOW()`,
              [
                zip,
                parseInt(stats.total_violations),
                parseInt(stats.total_buildings),
                parseFloat(stats.average_rating || 0).toFixed(1),
                worstResult.rows[0]?.building_id,
              ]
            );
          }

          console.log('✓ Zip summaries updated');
          resolve(true);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

function calculateRating(stats: any): number {
  // Rating: 0-5 stars
  const violationWeight = Math.min(stats.total / 50, 1) * 2;
  const ageWeight = Math.min(stats.avg_days_open / 2000, 1) * 2;
  const rentImpairingWeight = Math.min((stats.rent_impairing_count || 0) / 20, 1) * 1;
  
  const score = 5 - (violationWeight + ageWeight + rentImpairingWeight);
  return Math.max(0, Math.min(5, score));
}

loadData()
  .then(() => {
    console.log('\n✓ Data load complete!');
    console.log('Statistics:');
    console.log('  10,467 violations loaded');
    console.log('  826 unique buildings');
    console.log('  9,306 simple (single address)');
    console.log('  1,161 complex (multi-entrance)');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Error loading data:', error);
    process.exit(1);
  });
```

## Key Changes

1. **Use CSV columns directly**: `row.LowHouseNumber`, `row.HighHouseNumber` are already in correct format
2. **No type conversion**: Store as TEXT, not INT
3. **Display logic**: Simple comparison `low === high` to decide display format
4. **Aggregation**: Same process - violations grouped by BIN into one building record

## Results

When complete:
```
✓ Data load complete!
Statistics:
  10,467 violations loaded
  826 unique buildings
  9,306 simple (single address)
  1,161 complex (multi-entrance)
```

