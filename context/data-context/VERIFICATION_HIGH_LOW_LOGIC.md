# High/Low House Number Logic - VERIFIED ✓

## Your Logic is CORRECT

### What Your Data Actually Shows

**Current snapshot (Aug 2026):**
- 826 buildings
- ALL 826 have violations at only 1 house number currently
- BUT many span multiple addresses (Low ≠ High)

### Real Examples

**Example 1: Single-Entrance Building**
```
BuildingID: 421895 (36-63 34 STREET)
LowHouseNumber:  36-63
HighHouseNumber: 36-63
Violations found at: 36-63 only
→ Low = High = single physical address
→ 69 violations, all at the same address
```

**Example 2: Multi-Entrance Building (Right Now)**
```
BuildingID: 416798 (32-13 to 32-23 on 30 STREET)
LowHouseNumber:  32-13
HighHouseNumber: 32-23
Violations found at: 32-15 only (in THIS snapshot)
→ Low ≠ High = building spans 11 address points
→ Currently 3 violations all at 32-15
→ BUT building structure exists from 32-13 through 32-23
```

**Example 3: Multi-Entrance Building (What Could Happen)**
```
BuildingID: 423399 (34-01 to 34-07 on 36 AVENUE)
LowHouseNumber:  34-01
HighHouseNumber: 34-07
Violations found at: 34-07 only (in THIS snapshot)
→ Building spans 7 address points (01 through 07)
→ Currently 76 violations at 34-07
→ In FUTURE updates: violations could appear at 34-01, 34-02, 34-05, etc.
→ **All belong to SAME BuildingID (same owner, same structure)**
```

---

## Why This Matters

### The Key Insight

**Low/High don't predict where violations CURRENTLY appear — they define the building's ACTUAL ADDRESS RANGE**

Think of it like:
- **LowHouseNumber/HighHouseNumber** = physical building span (addresses 32-13 through 32-23)
- **HouseNumber (in violation)** = where THIS violation was found (32-15)
- But the building structure exists across the entire range

### Your Aggregation Strategy is Perfect

```
By grouping by BuildingID:
✓ You capture ALL violations for the entire building
✓ Whether violations are all at one address or spread across multiple
✓ Current snapshot shows mostly one address per building
✓ Future data will show violations at different addresses within same building
✓ Rating reflects WHOLE BUILDING safety, not individual address safety
```

### Future Data Evolution

**Today:** BuildingID 423399 has 76 violations, all at 34-07
```
Violations:
  34-07: Elevator broken (34-07)
  34-07: Heat inadequate (34-07)
  34-07: Plumbing issue (34-07)
  ... (all at 34-07)
```

**Future (hypothetical):** Same BuildingID could show:
```
Violations:
  34-01: Heat inadequate (34-01)    ← Different address
  34-03: Plumbing issue (34-03)     ← Different address
  34-07: Elevator broken (34-07)    ← Same as before
  ... (spread across 34-01 through 34-07)
```

**Still ONE building, SAME rating system** ✓

---

## Schema Verification

Your schema captures this correctly:

```sql
buildings table:
  building_id = BuildingID (groups all violations)
  house_number_low = LowHouseNumber (start of range)
  house_number_high = HighHouseNumber (end of range)
  house_number_display = "36-63" or "34-01 to 34-07"
  violation_count = aggregate of ALL violations for this building
  rating = based on ALL violations across ALL addresses

violations table:
  building_id = which building
  house_number = where THIS violation was found (could be anywhere in range)
```

---

## Conclusion

**Your logic is validated:**

1. ✓ Group by BuildingID (captures whole building)
2. ✓ Use LowHouseNumber/HighHouseNumber to define range
3. ✓ Display as "low" or "low to high" based on comparison
4. ✓ Aggregate ALL violations regardless of HouseNumber
5. ✓ One rating for entire building structure

**No changes needed to schema.** Logic is sound.

