# Address Range Logic Update - Multi-Entrance Buildings

## Overview
Updated schema and code to handle NYC buildings with multiple entrances/wings under a single Building Identification Number (BIN).

## Key Concept

**Simple Building** (single address):
- house_number_low = 100, house_number_high = 100
- house_number_display = "100"
- One physical entrance

**Complex Building** (multiple entrances/wings):
- house_number_low = 100, house_number_high = 200  
- house_number_display = "100-200"
- Multiple physical entrances at different street addresses
- **All violations aggregate into ONE building record**
- **One rating score covers entire structure**

Example: 100-200 Main Street represents one large building that has:
- Main entrance at 100 Main St
- Secondary entrance at 200 Main St
- Possibly other entrances at 110, 120, 130, etc.

All violations across all these entrances belong to the same building (same BIN).

---

## Schema Changes

### buildings table
```sql
-- NEW COLUMNS:
house_number_low INT NOT NULL         -- Lowest address (100)
house_number_high INT NOT NULL        -- Highest address (200)
house_number_display TEXT NOT NULL    -- For UI ("100" or "100-200")

-- REMOVED/CHANGED:
house_number TEXT → split into low/high/display
```

### violations table
```sql
-- UNCHANGED but now groups by address:
house_number TEXT  -- Which entrance (100, 150, 200, etc.)
building_id TEXT   -- Same BIN for all entrances
```

---

## Data Loader Logic

```typescript
// 1. Read CSV violations
// 2. Group by BIN (building_id)
// 3. For each BIN, collect ALL house_number values
// 4. Find min and max house numbers
// 5. Create building record with low/high/display

// Example:
// Violations 1,2,3: BIN-12345, house_number 100
// Violation 4: BIN-12345, house_number 150  
// Violation 5: BIN-12345, house_number 200
// => buildings: low=100, high=200, display="100-200"
// => violation_count=5 (all violations for this building)
```

---

## Query Examples

### Find building by address (any entrance)
```sql
SELECT * FROM buildings 
WHERE street_name = 'Main Street' 
AND house_number_low <= 150 
AND house_number_high >= 150;
-- Returns building even if user searched "150" but actual building is "100-200"
```

### Get all violations for a building (all entrances)
```sql
SELECT * FROM violations 
WHERE building_id = 'BIN-12345'
ORDER BY house_number, inspection_date DESC;
-- Returns violations from entrance 100, 150, 200, etc.
```

### Group violations by entrance
```typescript
const violations = await query(/* ... */);
const byEntrance = violations.reduce((acc, v) => {
  const entrance = v.house_number || 'Unknown';
  if (!acc[entrance]) acc[entrance] = [];
  acc[entrance].push(v);
  return acc;
}, {});

// Result:
// "100": [violation1, violation2, ...]
// "150": [violation3, violation4, ...]
// "200": [violation5, ...]
```

---

## UI Display

### Building Card
```
100-200 Main Street
Rating: 2.3 / 5.0
Violations: 45
Rent-Impairing: 8
```

### Violations Expanded
```
Entrance/Wing #100
  - Heat inadequate (120 days open)
  - Plumbing issue (90 days open)

Entrance/Wing #150
  - Window broken (30 days open)

Entrance/Wing #200
  - Electrical hazard (180 days open) [RENT-IMPAIRING]
```

---

## Why This Matters

1. **NYC Reality**: Large buildings often span multiple street addresses
2. **Tenant Decision**: User cares about the WHOLE building, not individual entrances
3. **Landlord Liability**: One landlord owns the structure and is responsible for all violations
4. **Safety Rating**: Rating should reflect ALL issues across the building

---

## Files Updated

1. **schema_firebase.sql**
   - Added house_number_low, house_number_high, house_number_display
   - Updated comments explaining multi-entrance buildings
   - Added sample queries

2. **snippets.md**
   - Updated data loader with address range logic
   - Added "Address Range Queries" section with examples
   - Added UI component examples (BuildingCard, ViolationsList)
   - Shows how to group violations by entrance

---

## Testing the Logic

```bash
# Run data loader
npx ts-node scripts/loadData.ts

# Check results
psql violations_dev

# Simple buildings (single address)
SELECT * FROM buildings WHERE house_number_low = house_number_high LIMIT 5;

# Complex buildings (multiple addresses)
SELECT * FROM buildings WHERE house_number_low < house_number_high LIMIT 5;

# All violations for a complex building
SELECT house_number, COUNT(*) as count 
FROM violations 
WHERE building_id = 'BIN-12345' 
GROUP BY house_number;
```

---

## Migration Notes (if updating existing database)

```sql
-- Add new columns to existing buildings table
ALTER TABLE buildings ADD COLUMN house_number_low INT;
ALTER TABLE buildings ADD COLUMN house_number_high INT;
ALTER TABLE buildings ADD COLUMN house_number_display TEXT;

-- Populate based on violations data
-- For each building, find min/max house numbers from violations
UPDATE buildings b
SET 
  house_number_low = (SELECT MIN(CAST(house_number AS INT)) FROM violations WHERE building_id = b.building_id),
  house_number_high = (SELECT MAX(CAST(house_number AS INT)) FROM violations WHERE building_id = b.building_id)
WHERE house_number_low IS NULL;

-- Generate display
UPDATE buildings
SET house_number_display = 
  CASE 
    WHEN house_number_low = house_number_high THEN CAST(house_number_low AS TEXT)
    ELSE CONCAT(house_number_low, '-', house_number_high)
  END
WHERE house_number_display IS NULL;

-- Make columns NOT NULL
ALTER TABLE buildings ALTER COLUMN house_number_low SET NOT NULL;
ALTER TABLE buildings ALTER COLUMN house_number_high SET NOT NULL;
ALTER TABLE buildings ALTER COLUMN house_number_display SET NOT NULL;
```
