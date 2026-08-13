# Code Snippets - NYC Building Violations App

> **⚠ STATUS (2026-08-11):** This is pre-build reference material (Postgres-based); the actual app in `web/` uses SQLite and its own loader (`web/lib/csvLoader.ts`, `web/lib/loadIntoDb.ts`), not this code directly. One specific bug to flag if anyone copies from here: the Data Loader section below uses `parseInt(row.HouseNumber)` on NYC block-lot house numbers (e.g. "14-31"), which truncates to `14` and silently corrupts every multi-entrance address range. `DATA_LOADER_CORRECTED.md` in this same folder fixes it (keeps house numbers as text); `web/lib/csvLoader.ts` is the actual, currently-running fix. See `SESSION_STATE.md`'s `[2026-08-04] build` entry for how this was found.

## Table of Contents
1. [Database Schema](#database-schema)
2. [Data Loader](#data-loader)
3. [Validation (In-House)](#validation-in-house)
4. [Rate Limiting (In-House)](#rate-limiting-in-house)
5. [Error Logging (In-House)](#error-logging-in-house)
6. [Custom useQuery Hook](#custom-usequery-hook)
7. [CSS (In-House)](#css-in-house)
8. [API Client](#api-client)
9. [Firebase Auth](#firebase-auth)
10. [Protected API Routes](#protected-api-routes)
11. [Database Sync on Login](#database-sync-on-login)
12. [Environment Configuration](#environment-configuration)

---

## Database Schema

### PostgreSQL Full Schema (with Firebase Auth)
```sql
-- Zip codes table
CREATE TABLE zip_codes (
  postcode TEXT PRIMARY KEY,
  borough TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Buildings table (core MVP)
CREATE TABLE buildings (
  building_id TEXT PRIMARY KEY,
  bin TEXT UNIQUE,
  bbl TEXT UNIQUE,
  house_number TEXT NOT NULL,
  street_name TEXT NOT NULL,
  postcode TEXT NOT NULL REFERENCES zip_codes(postcode),
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  violation_count INT DEFAULT 0,
  rent_impairing_count INT DEFAULT 0,
  avg_days_open INT DEFAULT 0,
  rating DECIMAL(3, 1),
  last_violation_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(postcode) REFERENCES zip_codes(postcode),
  INDEX idx_postcode (postcode),
  INDEX idx_rating (rating),
  INDEX idx_coordinates (latitude, longitude)
);

-- Violations table
CREATE TABLE violations (
  violation_id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(building_id),
  postcode TEXT NOT NULL REFERENCES zip_codes(postcode),
  inspection_date DATE NOT NULL,
  current_status TEXT NOT NULL,
  violation_status TEXT NOT NULL,
  rent_impairing BOOLEAN DEFAULT FALSE,
  nov_description TEXT,
  nov_type TEXT,
  days_open INT GENERATED ALWAYS AS (CAST((NOW() - inspection_date) / INTERVAL '1 day' AS INT)) STORED,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_building (building_id),
  INDEX idx_postcode (postcode),
  INDEX idx_status (current_status),
  INDEX idx_date (inspection_date)
);

-- Zip code summary (pre-computed)
CREATE TABLE zip_summaries (
  postcode TEXT PRIMARY KEY REFERENCES zip_codes(postcode),
  total_violations INT DEFAULT 0,
  total_buildings INT DEFAULT 0,
  average_rating DECIMAL(3, 1),
  worst_building_id TEXT REFERENCES buildings(building_id),
  last_updated TIMESTAMP DEFAULT NOW(),
  INDEX idx_updated (last_updated)
);

-- Users table (Firebase UID as primary key)
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
);

-- Saved buildings (Phase 2)
CREATE TABLE saved_buildings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  building_id TEXT NOT NULL REFERENCES buildings(building_id),
  saved_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, building_id),
  INDEX idx_user (user_id),
  INDEX idx_building (building_id)
);

-- Audit logs (track user actions for analytics)
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_id TEXT,
  resource_type TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  INDEX idx_user (user_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_action (action)
);
```

---

## Data Loader

### TypeScript CSV to PostgreSQL Loader (with Building Address Range Logic)
```typescript
// scripts/loadData.ts
import fs from 'fs';
import csv from 'csv-parser';
import { Pool } from 'pg';
import path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Building key: combines street name, low/high house numbers to identify multi-entrance buildings
// Example: "Main St|100|200" = one building (100 Main to 200 Main, same structure with wings)
// Example: "Main St|123|123" = one building (single address)
function getBuildingKey(streetName: string, houseNumber: string): string {
  // For a given street + house number, find the building it belongs to
  // This will be normalized across all violations for the same BIN
  // Assuming BIN is the primary identifier
  return `${streetName}|${houseNumber}`;
}

async function loadData() {
  const csvPath = path.join(
    process.cwd(),
    'Housing_Maintenance_Code_Violations_20260803.csv'
  );

  const violations: any[] = [];
  const buildingsByBin = new Map<string, any>(); // Group by BIN (building_id)

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        // ⚠ BUG (see status note at top of file): parseInt() truncates NYC
        // block-lot house numbers ("14-31" -> 14), corrupting multi-entrance
        // addresses. Use DATA_LOADER_CORRECTED.md's approach instead — keep
        // LowHouseNumber/HighHouseNumber as text end-to-end.
        const houseNumberNum = parseInt(row.HouseNumber) || 0;

        violations.push({
          ViolationID: row.ViolationID,
          BuildingID: row.BuildingID,
          Postcode: row.Postcode,
          HouseNumber: row.HouseNumber,
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

        // Track building by BIN (multiple violations can be at different entrances)
        if (!buildingsByBin.has(row.BuildingID)) {
          buildingsByBin.set(row.BuildingID, {
            building_id: row.BuildingID,
            bin: row.BIN,
            bbl: row.BBL,
            street_name: row.StreetName,
            postcode: row.Postcode,
            house_numbers: [houseNumberNum], // Track all house numbers for this building
            latitude: parseFloat(row.Latitude),
            longitude: parseFloat(row.Longitude),
            violations_count: 1,
          });
        } else {
          const building = buildingsByBin.get(row.BuildingID);
          if (!building.house_numbers.includes(houseNumberNum)) {
            building.house_numbers.push(houseNumberNum);
          }
          building.violations_count++;
        }
      })
      .on('end', async () => {
        try {
          console.log(`Loaded ${violations.length} violations, ${buildingsByBin.size} buildings`);

          // Insert violations with specific entrance house_number
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
                v.HouseNumber,
                new Date(v.InspectionDate).toISOString().split('T')[0],
                v.CurrentStatus,
                v.ViolationStatus,
                v.RentImpairing ? 1 : 0,
                v.NOVDescription,
                v.NovType,
              ]
            );
          }

          console.log('Violations inserted');

          // Process buildings: calculate low/high house numbers and aggregations
          for (const [buildingId, building] of buildingsByBin) {
            // Calculate house number range for multi-entrance buildings
            const houseNumbers = building.house_numbers.sort((a: number, b: number) => a - b);
            const house_number_low = houseNumbers[0];
            const house_number_high = houseNumbers[houseNumbers.length - 1];
            
            // Display format: "123" for single, "123-456" for multi-entrance
            const house_number_display = house_number_low === house_number_high
              ? `${house_number_low}`
              : `${house_number_low}-${house_number_high}`;

            // Get aggregated stats across ALL violations for this building (all entrances)
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
                rating = $14,
                last_violation_date = $15`,
              [
                buildingId,
                building.bin,
                building.bbl,
                house_number_low,
                house_number_high,
                house_number_display,
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

            console.log(`✓ Building ${buildingId}: ${house_number_display} ${building.street_name}`);
          }

          console.log('Buildings aggregated');

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

          console.log('Zip summaries updated');
          resolve(true);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

function calculateRating(stats: any): number {
  // Rating formula (0-5 stars)
  // Aggregates ALL violations for the building (all entrances/wings combined)
  const violationWeight = Math.min(stats.total / 50, 1) * 2; // Max 2 points
  const ageWeight = Math.min(stats.avg_days_open / 2000, 1) * 2; // Max 2 points
  const rentImpairingWeight = Math.min((stats.rent_impairing_count || 0) / 20, 1) * 1; // Max 1 point
  
  const score = 5 - (violationWeight + ageWeight + rentImpairingWeight);
  return Math.max(0, Math.min(5, score));
}

// Run: npx ts-node scripts/loadData.ts
loadData()
  .then(() => {
    console.log('✓ Data loaded successfully');
    console.log('Building address ranges assigned:');
    console.log('  - Single entrance: "123" (low = high = 123)');
    console.log('  - Multi-entrance/wing: "123-456" (low = 123, high = 456)');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Error loading data:', error);
    process.exit(1);
  });
```

**Install:**
```bash
npm install pg csv-parser
```

---

## Validation (In-House)

### lib/validation.ts
```typescript
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateZipCode(zip: string): ValidationResult {
  if (!zip) {
    return { valid: false, error: 'Zip code is required' };
  }
  if (!/^\d{5}$/.test(zip)) {
    return { valid: false, error: 'Zip code must be 5 digits' };
  }
  return { valid: true };
}

export function validateBuildingId(id: string): ValidationResult {
  if (!id || id.trim().length === 0) {
    return { valid: false, error: 'Building ID is required' };
  }
  return { valid: true };
}

export function validateEmail(email: string): ValidationResult {
  if (!email) {
    return { valid: false, error: 'Email is required' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
}

export function validatePassword(password: string): ValidationResult {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain number' };
  }
  return { valid: true };
}
```

### Usage in API Route
```typescript
// app/api/buildings/route.ts
import { validateZipCode } from '@/lib/validation';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get('zip');

  const validation = validateZipCode(zip || '');
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  // Proceed with query
}
```

---

## Rate Limiting (In-House)

### lib/rateLimiter.ts
```typescript
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const requestCounts = new Map<string, RateLimitRecord>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  limit: number;
  remaining: number;
}

export function rateLimit(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 3600000 // 1 hour
): RateLimitResult {
  const now = Date.now();
  const record = requestCounts.get(identifier);

  // New window or expired
  if (!record || now > record.resetTime) {
    requestCounts.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - 1,
    };
  }

  // Within window
  if (record.count >= maxRequests) {
    return {
      allowed: false,
      retryAfter: Math.ceil((record.resetTime - now) / 1000),
      limit: maxRequests,
      remaining: 0,
    };
  }

  record.count++;
  return {
    allowed: true,
    limit: maxRequests,
    remaining: maxRequests - record.count,
  };
}

// Cleanup: run periodically to prevent memory leaks
export function cleanupOldRecords() {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now > record.resetTime) {
      requestCounts.delete(key);
    }
  }
}
```

### Usage in Middleware
```typescript
// app/api/middleware.ts
import { rateLimit, cleanupOldRecords } from '@/lib/rateLimiter';

export function withRateLimit(handler: Function) {
  // Cleanup every 10 minutes
  setInterval(cleanupOldRecords, 10 * 60 * 1000);

  return async (req: Request) => {
    const ip = req.headers.get('x-forwarded-for') || 'anonymous';
    const result = rateLimit(ip, 100, 3600000);

    if (!result.allowed) {
      return new Response('Too many requests', {
        status: 429,
        headers: {
          'Retry-After': result.retryAfter?.toString() || '3600',
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
        },
      });
    }

    const response = await handler(req);
    
    // Add rate limit headers
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    
    return response;
  };
}
```

---

## Error Logging (In-House)

### lib/logger.ts
```typescript
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  stack?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

const logs: LogEntry[] = [];

export function log(
  level: LogLevel,
  message: string,
  error?: Error,
  context?: string,
  metadata?: Record<string, any>
) {
  const entry: LogEntry = {
    level,
    message,
    context,
    stack: error?.stack,
    timestamp: new Date().toISOString(),
    metadata,
  };

  logs.push(entry);

  // Console output
  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]${context ? ` [${context}]` : ''}`;
  
  if (level === 'error') {
    console.error(prefix, message, error);
  } else if (level === 'warn') {
    console.warn(prefix, message);
  } else {
    console.log(prefix, message);
  }

  // TODO: Send to external service (Sentry, Datadog, etc.)
  // if (level === 'error') {
  //   await sendToExternalService(entry);
  // }
}

export function logInfo(message: string, context?: string, metadata?: Record<string, any>) {
  log('info', message, undefined, context, metadata);
}

export function logWarn(message: string, context?: string, metadata?: Record<string, any>) {
  log('warn', message, undefined, context, metadata);
}

export function logError(message: string, error?: Error, context?: string, metadata?: Record<string, any>) {
  log('error', message, error, context, metadata);
}

export function getLogs(limit: number = 100): LogEntry[] {
  return logs.slice(-limit);
}

export function clearLogs() {
  logs.length = 0;
}
```

### Usage in API Routes
```typescript
// app/api/buildings/route.ts
import { logError, logInfo } from '@/lib/logger';

export async function GET(req: Request) {
  try {
    logInfo('Fetching buildings', 'GET /api/buildings');
    const buildings = await db.buildings.findMany();
    return Response.json({ buildings });
  } catch (error) {
    logError('Failed to fetch buildings', error as Error, 'GET /api/buildings', {
      url: req.url,
      ip: req.headers.get('x-forwarded-for'),
    });
    return new Response('Internal server error', { status: 500 });
  }
}
```

---

## Custom useQuery Hook

### lib/useQuery.ts
```typescript
import { useState, useEffect, useCallback } from 'react';

export interface UseQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
  refetchInterval?: number;
  retry?: number;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

interface CacheEntry {
  data: any;
  timestamp: number;
}

const queryCache = new Map<string, CacheEntry>();

export function useQuery<T = any>(
  key: string,
  fetcher: () => Promise<T>,
  options: UseQueryOptions = {}
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const {
    enabled = true,
    staleTime = 5 * 60 * 1000, // 5 minutes default
    cacheTime = 10 * 60 * 1000, // 10 minutes default
    refetchInterval = undefined,
    retry = 3,
    onSuccess,
    onError,
  } = options;

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    // Check cache
    const cached = queryCache.get(key);
    const now = Date.now();
    if (cached && now - cached.timestamp < staleTime) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    let retryCount = 0;
    while (retryCount <= retry) {
      try {
        setLoading(true);
        const result = await fetcher();
        
        // Update cache
        queryCache.set(key, { data: result, timestamp: now });
        
        setData(result);
        setError(null);
        if (onSuccess) onSuccess(result);
        setLoading(false);
        return;
      } catch (err) {
        retryCount++;
        if (retryCount > retry) {
          const error = err instanceof Error ? err : new Error('Unknown error');
          setError(error);
          if (onError) onError(error);
          setData(null);
          setLoading(false);
        }
      }
    }
  }, [key, fetcher, enabled, staleTime, retry, onSuccess, onError]);

  useEffect(() => {
    fetchData();

    // Cleanup cache after cacheTime
    const timer = setTimeout(() => {
      queryCache.delete(key);
    }, cacheTime);

    // Setup refetch interval if specified
    let intervalId: NodeJS.Timeout | undefined;
    if (refetchInterval) {
      intervalId = setInterval(fetchData, refetchInterval);
    }

    return () => {
      clearTimeout(timer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [key, fetchData, cacheTime, refetchInterval]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}
```

### Usage in Components
```typescript
// components/BuildingsList.tsx
'use client';

import { useQuery } from '@/lib/useQuery';

export function BuildingsList({ zip }: { zip: string }) {
  const { data: buildings, loading, error, refetch } = useQuery(
    `buildings-${zip}`,
    () => fetch(`/api/buildings?zip=${zip}`).then(r => r.json()),
    {
      staleTime: 10 * 60 * 1000, // 10 minutes
      retry: 3,
      onSuccess: (data) => console.log('Buildings loaded:', data),
    }
  );

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {buildings?.map(b => (
        <div key={b.building_id}>{b.house_number} {b.street_name}</div>
      ))}
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

---

## CSS (In-House)

### styles/global.css
```css
/* Root CSS Variables */
:root {
  --primary: #2563eb;
  --primary-dark: #1d4ed8;
  --danger: #dc2626;
  --success: #10b981;
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-500: #6b7280;
  --gray-700: #374151;
  --gray-900: #111827;
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  --radius: 0.375rem;
  --radius-lg: 0.5rem;
}

/* Reset */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 1rem;
  line-height: 1.5;
  color: var(--gray-900);
  background-color: var(--gray-50);
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.2;
  margin-bottom: 1rem;
}

h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }
h4 { font-size: 1.125rem; }

p {
  margin-bottom: 1rem;
}

a {
  color: var(--primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

/* Container */
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

.container-sm {
  max-width: 640px;
  margin: 0 auto;
  padding: 1rem;
}

/* Buttons */
.btn {
  display: inline-block;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: var(--radius);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  text-decoration: none;
}

.btn-primary {
  background-color: var(--primary);
  color: white;
}

.btn-primary:hover {
  background-color: var(--primary-dark);
  box-shadow: var(--shadow-md);
}

.btn-primary:disabled {
  background-color: var(--gray-300);
  cursor: not-allowed;
}

.btn-secondary {
  background-color: white;
  color: var(--primary);
  border: 1px solid var(--primary);
}

.btn-secondary:hover {
  background-color: var(--gray-50);
}

.btn-danger {
  background-color: var(--danger);
  color: white;
}

.btn-danger:hover {
  background-color: #b91c1c;
}

.btn-small {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
}

.btn-block {
  display: block;
  width: 100%;
}

/* Forms */
input,
textarea,
select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--gray-300);
  border-radius: var(--radius);
  font-size: 1rem;
  font-family: inherit;
  transition: border-color 0.2s;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-group {
  margin-bottom: 1.5rem;
}

/* Cards */
.card {
  background-color: white;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.2s;
}

.card:hover {
  box-shadow: var(--shadow-md);
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.card-subtitle {
  font-size: 0.875rem;
  color: var(--gray-500);
  margin-bottom: 1rem;
}

/* Grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.grid-2 {
  grid-template-columns: repeat(2, 1fr);
}

.grid-3 {
  grid-template-columns: repeat(3, 1fr);
}

/* Flex */
.flex {
  display: flex;
  gap: 1rem;
}

.flex-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.flex-center {
  display: flex;
  justify-content: center;
  align-items: center;
}

/* Alerts */
.alert {
  padding: 1rem;
  border-radius: var(--radius-lg);
  margin-bottom: 1rem;
}

.alert-error {
  background-color: #fee;
  color: var(--danger);
  border: 1px solid #fcc;
}

.alert-success {
  background-color: #efe;
  color: var(--success);
  border: 1px solid #cfc;
}

.alert-info {
  background-color: #eff;
  color: var(--primary);
  border: 1px solid #cff;
}

/* Stars/Rating */
.stars {
  display: inline-flex;
  gap: 0.25rem;
}

.star {
  font-size: 1.5rem;
  color: var(--gray-300);
}

.star.filled {
  color: #fbbf24;
}

/* Responsive */
@media (max-width: 768px) {
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.25rem; }
  h3 { font-size: 1.125rem; }

  .grid {
    grid-template-columns: 1fr;
  }

  .grid-2,
  .grid-3 {
    grid-template-columns: 1fr;
  }

  .flex-between {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* Loading spinner */
.spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 3px solid var(--gray-200);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Utility classes */
.mt-1 { margin-top: 0.5rem; }
.mt-2 { margin-top: 1rem; }
.mb-1 { margin-bottom: 0.5rem; }
.mb-2 { margin-bottom: 1rem; }
.p-1 { padding: 0.5rem; }
.p-2 { padding: 1rem; }
.text-center { text-align: center; }
.text-muted { color: var(--gray-500); }
.text-sm { font-size: 0.875rem; }
.text-lg { font-size: 1.125rem; }
.font-bold { font-weight: 700; }
.hidden { display: none; }
```

---

## API Client

### lib/api.ts
```typescript
const API_BASE = '/api';

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface FetchOptions {
  method?: HTTPMethod;
  headers?: Record<string, string>;
  body?: unknown;
  token?: string;
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, token } = options;

  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const config: RequestInit = {
    method,
    headers: defaultHeaders,
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    config.body = JSON.stringify(body);
  }

  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `API error: ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T = any>(endpoint: string, token?: string) =>
    fetchApi<T>(endpoint, { method: 'GET', token }),

  post: <T = any>(endpoint: string, body: unknown, token?: string) =>
    fetchApi<T>(endpoint, { method: 'POST', body, token }),

  put: <T = any>(endpoint: string, body: unknown, token?: string) =>
    fetchApi<T>(endpoint, { method: 'PUT', body, token }),

  patch: <T = any>(endpoint: string, body: unknown, token?: string) =>
    fetchApi<T>(endpoint, { method: 'PATCH', body, token }),

  delete: <T = any>(endpoint: string, token?: string) =>
    fetchApi<T>(endpoint, { method: 'DELETE', token }),
};
```

### Usage
```typescript
// In components
const buildings = await api.get('/buildings', { zip: '11106' });
const user = await api.post('/auth/register', { email, password });
await api.delete(`/saved-buildings/${buildingId}`, token);
```

---

## Firebase Auth

### lib/firebase.ts (Frontend)
```typescript
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Connect to emulator in development
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  if (!auth.emulatorConfig) {
    connectAuthEmulator(auth, 'http://localhost:9099');
  }
}

// Helper to get current user's ID token
export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

// Helper to get current user's UID
export function getUserId(): string | null {
  return auth.currentUser?.uid || null;
}
```

### lib/firebaseAdmin.ts (Backend - verify tokens)
```typescript
import * as admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const adminAuth = admin.auth();

// Verify ID token and return UID
export async function verifyIdToken(token: string): Promise<string | null> {
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    return decodedToken.uid; // Firebase UID
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

// Get Firebase user by UID
export async function getFirebaseUser(uid: string) {
  try {
    return await adminAuth.getUser(uid);
  } catch (error) {
    console.error('Failed to get user:', error);
    return null;
  }
}
```

### Extract UID from request (Middleware)
```typescript
// lib/auth.ts
import { verifyIdToken } from '@/lib/firebaseAdmin';

export async function extractUserIdFromRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const uid = await verifyIdToken(token);
  return uid;
}

// Usage in API routes:
// const userId = await extractUserIdFromRequest(req);
// if (!userId) return new Response('Unauthorized', { status: 401 });
```

---

## Protected API Routes

### app/api/protected/route.ts (Example - Get saved buildings)
```typescript
import { extractUserIdFromRequest } from '@/lib/auth';
import { logError } from '@/lib/logger';
import { query } from '@/lib/db';

export async function GET(req: Request) {
  try {
    // Extract Firebase UID from authorization header
    const userId = await extractUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Query saved buildings for this user (uid = Firebase UID)
    const savedBuildings = await query(
      `SELECT sb.*, b.house_number, b.street_name, b.rating
       FROM saved_buildings sb
       JOIN buildings b ON sb.building_id = b.building_id
       WHERE sb.user_id = $1
       ORDER BY sb.saved_at DESC`,
      [userId]
    );

    return Response.json({ savedBuildings, userId });
  } catch (error) {
    logError('Failed to fetch saved buildings', error as Error, 'GET /api/saved-buildings');
    return new Response('Internal server error', { status: 500 });
  }
}
```

### app/api/saved-buildings/[buildingId]/route.ts (Save a building)
```typescript
import { extractUserIdFromRequest } from '@/lib/auth';
import { logError } from '@/lib/logger';
import { query } from '@/lib/db';

export async function POST(
  req: Request,
  { params }: { params: { buildingId: string } }
) {
  try {
    const userId = await extractUserIdFromRequest(req);
    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { buildingId } = params;

    // Insert saved building (uid as user_id)
    await query(
      `INSERT INTO saved_buildings (user_id, building_id, saved_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, building_id) DO NOTHING`,
      [userId, buildingId]
    );

    // Log audit event
    await query(
      `INSERT INTO audit_logs (user_id, action, resource_id, resource_type, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        'save_building',
        buildingId,
        'building',
        req.headers.get('x-forwarded-for') || 'unknown'
      ]
    );

    return Response.json({ saved: true, buildingId });
  } catch (error) {
    logError('Failed to save building', error as Error, 'POST /api/saved-buildings');
    return new Response('Internal server error', { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { buildingId: string } }
) {
  try {
    const userId = await extractUserIdFromRequest(req);
    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { buildingId } = params;

    // Delete saved building
    await query(
      `DELETE FROM saved_buildings WHERE user_id = $1 AND building_id = $2`,
      [userId, buildingId]
    );

    return Response.json({ deleted: true, buildingId });
  } catch (error) {
    logError('Failed to delete saved building', error as Error, 'DELETE /api/saved-buildings');
    return new Response('Internal server error', { status: 500 });
  }
}
```

### withAuth Middleware (Optional wrapper)
```typescript
// lib/withAuth.ts
import { extractUserIdFromRequest } from '@/lib/auth';

type Handler = (req: Request, userId: string) => Promise<Response>;

export function withAuth(handler: Handler) {
  return async (req: Request) => {
    const userId = await extractUserIdFromRequest(req);
    
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      return await handler(req, userId);
    } catch (error) {
      console.error('Route handler error:', error);
      return new Response('Internal server error', { status: 500 });
    }
  };
}

// Usage in API routes:
// export const GET = withAuth(async (req, userId) => {
//   const data = await query('SELECT * FROM users WHERE user_id = $1', [userId]);
//   return Response.json({ data });
// });
```

---

## Database Sync on Login

### app/api/auth/sync/route.ts (Sync Firebase user to database)
```typescript
import { extractUserIdFromRequest } from '@/lib/auth';
import { adminAuth } from '@/lib/firebaseAdmin';
import { logInfo, logError } from '@/lib/logger';
import { query } from '@/lib/db';

export async function POST(req: Request) {
  try {
    // Extract Firebase UID from token
    const userId = await extractUserIdFromRequest(req);
    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get Firebase user details
    const firebaseUser = await adminAuth.getUser(userId);
    if (!firebaseUser) {
      return new Response('User not found in Firebase', { status: 404 });
    }

    // Sync to database (idempotent - insert or update)
    await query(
      `INSERT INTO users (user_id, email, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         email = $2,
         updated_at = NOW()`,
      [userId, firebaseUser.email]
    );

    logInfo(`User synced to database: ${userId}`, 'POST /api/auth/sync', {
      email: firebaseUser.email,
    });

    return Response.json({
      synced: true,
      userId, // Firebase UID
      email: firebaseUser.email,
    });
  } catch (error) {
    logError('Failed to sync user to database', error as Error, 'POST /api/auth/sync');
    return new Response('Internal server error', { status: 500 });
  }
}
```

### Frontend: Register (Create account)
```typescript
// components/RegisterForm.tsx
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, getIdToken } from '@/lib/firebase';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export async function handleRegister(email: string, password: string) {
  try {
    // Create Firebase user (returns uid in userCredential.user.uid)
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    const token = await userCredential.user.getIdToken();

    // Sync Firebase user to PostgreSQL
    const response = await api.post('/auth/sync', {}, token);

    if (response.synced) {
      logInfo(`User registered and synced: ${uid}`);
      window.location.href = '/dashboard';
    }
  } catch (error) {
    logError('Registration failed', error as Error);
  }
}
```

### Frontend: Login
```typescript
// components/LoginForm.tsx
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, getIdToken } from '@/lib/firebase';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export async function handleLogin(email: string, password: string) {
  try {
    // Sign in with Firebase (returns uid in userCredential.user.uid)
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    const token = await userCredential.user.getIdToken();

    // Sync user to database
    const response = await api.post('/auth/sync', {}, token);

    if (response.synced) {
      logInfo(`User logged in: ${uid}`);
      window.location.href = '/dashboard';
    }
  } catch (error) {
    logError('Login failed', error as Error);
  }
}
```

### Frontend: Auto-sync on mount (check if user is already authenticated)
```typescript
// lib/useAuth.ts
import { useEffect, useState } from 'react';
import { auth, getIdToken } from '@/lib/firebase';
import { api } from '@/lib/api';

export function useAuth() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        // User is logged in - sync to database
        const token = await user.getIdToken();
        try {
          await api.post('/auth/sync', {}, token);
          setUserId(user.uid); // Firebase UID
        } catch (error) {
          console.error('Failed to sync user:', error);
        }
      } else {
        setUserId(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return { userId, loading };
}
```

---

## Environment Configuration

### Getting Firebase Credentials

**Public keys (safe to commit):**
1. Go to Firebase Console → Project Settings → General
2. Copy these values to `.env.local`:
   - API Key
   - Auth Domain
   - Project ID
   - Storage Bucket
   - Messaging Sender ID
   - App ID

**Private keys (NEVER commit):**
1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key"
3. Save the downloaded JSON file — copy its entire contents to `FIREBASE_SERVICE_ACCOUNT`

### .env.local (Development)
```
# Firebase Public (safe - commit to git)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyD...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=violations-app.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=violations-app
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=violations-app.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcd...

# Firebase Admin SDK (secret - never commit)
# Entire service account JSON as a string
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"violations-app","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xyz@violations-app.iam.gserviceaccount.com","client_id":"123456789","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"..."}'

# Database
DATABASE_URL=postgresql://violations_user:password@localhost:5432/violations_dev

# App
NEXT_PUBLIC_API_BASE=http://localhost:3000
NODE_ENV=development
```

### .env.production
```
# Firebase Public (same config, different project if desired)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyD...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=violations-app-prod.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=violations-app-prod
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=violations-app-prod.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=987654321
NEXT_PUBLIC_FIREBASE_APP_ID=1:987654321:web:xyz...

# Firebase Admin SDK (production service account)
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'

# Database (production - use managed service)
DATABASE_URL=postgresql://admin:SecurePassword123@prod-db.c.posgtres.railway.app:5432/violations

# App
NEXT_PUBLIC_API_BASE=https://violations.app
NODE_ENV=production
```

### .env.test
```
# Firebase Test (emulator mode if needed)
NEXT_PUBLIC_FIREBASE_API_KEY=test-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost:9099
NEXT_PUBLIC_FIREBASE_PROJECT_ID=violations-test
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=violations-test.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123
NEXT_PUBLIC_FIREBASE_APP_ID=1:123:web:abc

# Firebase Admin (test service account with limited permissions)
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'

# Database (test - local isolated instance)
DATABASE_URL=postgresql://test:test@localhost:5432/violations_test

NODE_ENV=test
```

### .gitignore (Prevent accidental secret leaks)
```
# Environment - NEVER commit these files
.env
.env.local
.env.*.local
.env.production.local
.env.test.local

# Secret files
firebase-service-account.json
firebase-*.json
*.key
*.pem

# Dependencies
node_modules/
/.pnp
.pnp.js

# Build
/.next/
/out/
/build/
dist/

# Testing
/.coverage/
coverage/

# IDE
.vscode/
.idea/
.DS_Store
*.swp
*.swo
*~

# OS
Thumbs.db

# Data & Logs
*.db
*.log
/data/
/uploads/
/temp/
```

### How to Structure Secrets in Railway/Vercel

**For Railway (deployed backend):**
1. In Railway dashboard → Variables
2. Add each `NEXT_PUBLIC_*` variable
3. Add `FIREBASE_SERVICE_ACCOUNT` as a long string (copy-paste entire JSON)
4. Add `DATABASE_URL` (Railway provides this auto when you add Postgres plugin)

**For Vercel (deployed frontend):**
1. In Vercel dashboard → Settings → Environment Variables
2. Add each `NEXT_PUBLIC_*` variable (these get baked into client JS)
3. You don't deploy `FIREBASE_SERVICE_ACCOUNT` to Vercel (only backend needs it)

---

## Database Connection

### lib/db.ts
```typescript
import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export { pool };

// Query multiple rows
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows;
}

// Query single row
export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

// Execute (no return)
export async function execute(text: string, params?: any[]): Promise<number> {
  const res = await pool.query(text, params);
  return res.rowCount || 0;
}
```

## Address Range Queries (Multi-Entrance Buildings)

### Understand Building Address Ranges
```typescript
// Simple building: single address
// house_number_low = 100, house_number_high = 100
// house_number_display = "100"
// Only one entrance

// Complex building: multiple entrances/wings
// house_number_low = 100, house_number_high = 200
// house_number_display = "100-200"
// This represents ONE building with separate entrances at 100, 110, 120, ... 200

// Violations span all addresses:
// Violation 1: house_number = 100 (entrance A)
// Violation 2: house_number = 150 (entrance B)
// Violation 3: house_number = 200 (entrance C)
// But all share same building_id (BIN)

// Rating aggregates ALL violations across all addresses
```

### Get Building by Address (Any entrance number)
```typescript
// User searches "150 Main Street"
// Find building where 150 falls in address range

const building = await queryOne(
  `SELECT * FROM buildings 
   WHERE street_name = $1 
   AND house_number_low <= $2 
   AND house_number_high >= $2
   LIMIT 1`,
  ['Main Street', 150]
);

// Returns: house_number_display = "100-200", rating includes all violations from 100-200 Main
```

### Get All Violations for All Entrances of a Building
```typescript
// Building 100-200 Main St might have violations at 100, 150, and 200
// Get them all:

const violations = await query(
  `SELECT * FROM violations 
   WHERE building_id = $1
   ORDER BY house_number, inspection_date DESC`,
  [buildingId]
);

// Results show violations grouped by entrance number
// house_number field tells you which entrance/wing has the issue
```

### Display Building Address for UI
```typescript
// Use house_number_display instead of concatenating

const displayAddress = (building: Building) => {
  return `${building.house_number_display} ${building.street_name}`;
};

// Examples:
// displayAddress({ house_number_display: '100', street_name: 'Main St' })
// => "100 Main St"

// displayAddress({ house_number_display: '100-200', street_name: 'Main St' })
// => "100-200 Main St"
```

## Common Queries with Firebase UID

### Get User by UID
```typescript
// Firebase UID is stored in users.user_id column
const user = await queryOne(
  'SELECT * FROM users WHERE user_id = $1',
  [firebaseUid]
);
```

### Get User's Saved Buildings
```typescript
const savedBuildings = await query(
  `SELECT sb.*, b.house_number, b.street_name, b.rating, b.violation_count
   FROM saved_buildings sb
   JOIN buildings b ON sb.building_id = b.building_id
   WHERE sb.user_id = $1
   ORDER BY sb.saved_at DESC`,
  [firebaseUid]
);
```

### Save a Building for User
```typescript
await execute(
  `INSERT INTO saved_buildings (user_id, building_id, saved_at)
   VALUES ($1, $2, NOW())
   ON CONFLICT (user_id, building_id) DO NOTHING`,
  [firebaseUid, buildingId]
);
```

### Remove Saved Building
```typescript
await execute(
  'DELETE FROM saved_buildings WHERE user_id = $1 AND building_id = $2',
  [firebaseUid, buildingId]
);
```

### Check if Building is Saved
```typescript
const saved = await queryOne<{ id: number }>(
  'SELECT id FROM saved_buildings WHERE user_id = $1 AND building_id = $2',
  [firebaseUid, buildingId]
);

return !!saved;
```

### Log User Action
```typescript
await execute(
  `INSERT INTO audit_logs (user_id, action, resource_id, resource_type, ip_address)
   VALUES ($1, $2, $3, $4, $5)`,
  [
    firebaseUid,
    'view_building', // action
    buildingId,
    'building',
    ipAddress
  ]
);
```

### Get User's Recent Actions
```typescript
const actions = await query(
  `SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 50`,
  [firebaseUid]
);
```

---

## Quick Reference

### Public API Route (No auth required)
```typescript
import { validateZipCode } from '@/lib/validation';
import { logError } from '@/lib/logger';
import { query } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const zip = searchParams.get('zip');

    const validation = validateZipCode(zip || '');
    if (!validation.valid) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const buildings = await query(
      'SELECT * FROM buildings WHERE postcode = $1 LIMIT 10',
      [zip]
    );

    return Response.json({ buildings });
  } catch (error) {
    logError('Failed to fetch buildings', error as Error, 'GET /api/buildings');
    return new Response('Internal server error', { status: 500 });
  }
}
```

### Protected API Route (Firebase auth required)
```typescript
import { extractUserIdFromRequest } from '@/lib/auth';
import { logError } from '@/lib/logger';
import { query } from '@/lib/db';

export async function GET(req: Request) {
  try {
    // Extract Firebase UID from authorization header
    const userId = await extractUserIdFromRequest(req);
    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Query with user_id (Firebase UID)
    const savedBuildings = await query(
      `SELECT sb.*, b.house_number, b.street_name, b.rating
       FROM saved_buildings sb
       JOIN buildings b ON sb.building_id = b.building_id
       WHERE sb.user_id = $1`,
      [userId]
    );

    return Response.json({ savedBuildings });
  } catch (error) {
    logError('Failed to fetch saved buildings', error as Error, 'GET /api/saved-buildings');
    return new Response('Internal server error', { status: 500 });
  }
}
```

### Component Example: Display Building with Address Range
```typescript
'use client';

interface Building {
  building_id: string;
  house_number_display: string;  // "100" or "100-200"
  street_name: string;
  rating: number;
  violation_count: number;
  rent_impairing_count: number;
}

export function BuildingCard({ building }: { building: Building }) {
  return (
    <div className="card">
      <h3>{building.house_number_display} {building.street_name}</h3>
      
      <div className="flex-between">
        <div>
          <div className="text-sm text-muted">Rating</div>
          <div className="text-lg font-bold">{building.rating?.toFixed(1)} / 5.0</div>
        </div>
        <div>
          <div className="text-sm text-muted">Violations</div>
          <div className="text-lg font-bold">{building.violation_count}</div>
        </div>
        <div>
          <div className="text-sm text-muted">Rent-Impairing</div>
          <div className="text-lg font-bold">{building.rent_impairing_count}</div>
        </div>
      </div>
    </div>
  );
}
```

### Component Example: Show Violations by Entrance
```typescript
'use client';

interface Violation {
  violation_id: string;
  house_number: string;      // Which entrance: "100", "150", or "200"
  inspection_date: string;
  nov_description: string;
  days_open: number;
  rent_impairing: boolean;
}

export function ViolationsList({ violations }: { violations: Violation[] }) {
  // Group violations by entrance number
  const byEntrance = violations.reduce((acc, v) => {
    const entrance = v.house_number || 'Unknown';
    if (!acc[entrance]) acc[entrance] = [];
    acc[entrance].push(v);
    return acc;
  }, {} as Record<string, Violation[]>);

  return (
    <div>
      {Object.entries(byEntrance).map(([entrance, violationsList]) => (
        <div key={entrance} className="mb-4">
          <h4 className="font-bold">Entrance/Wing #{entrance}</h4>
          {violationsList.map(v => (
            <div key={v.violation_id} className="card mb-2">
              <div className="flex-between">
                <div>
                  <div>{v.nov_description}</div>
                  <div className="text-sm text-muted">{v.inspection_date}</div>
                </div>
                <div>
                  <div className="text-sm">Open {v.days_open} days</div>
                  {v.rent_impairing && (
                    <div className="text-sm font-bold text-danger">Rent-Impairing</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

### Component Template (with useAuth hook)
```typescript
'use client';

import { useAuth } from '@/lib/useAuth';
import { useQuery } from '@/lib/useQuery';
import { useState } from 'react';
import { getIdToken } from '@/lib/firebase';

export function MyComponent() {
  const { userId, loading: authLoading } = useAuth();
  const [zip, setZip] = useState('');
  
  // Public query (no auth needed)
  const { data: buildings, loading } = useQuery(
    `buildings-${zip}`,
    () => fetch(`/api/buildings?zip=${zip}`).then(r => r.json()),
    { enabled: !!zip }
  );

  // Protected query (requires auth + Firebase token)
  const { data: savedBuildings } = useQuery(
    `saved-${userId}`,
    async () => {
      if (!userId) return [];
      const token = await getIdToken();
      return fetch('/api/saved-buildings', {
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(r => r.json());
    },
    { enabled: !!userId }
  );

  if (authLoading) return <div>Loading auth...</div>;

  return (
    <div>
      <input 
        value={zip} 
        onChange={(e) => setZip(e.target.value)}
        placeholder="Enter zip code"
      />
      {loading && <div>Loading buildings...</div>}
      {buildings && <div>{/* render buildings */}</div>}
      
      {userId && (
        <div>
          <h2>Your saved buildings</h2>
          {savedBuildings?.map(b => (
            <div key={b.building_id}>{b.house_number} {b.street_name}</div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Summary: Firebase UID Flow

1. **User registers/logs in** → Firebase creates account, generates `uid`
2. **Frontend gets token** → `auth.currentUser.getIdToken()`
3. **Send token in request** → `Authorization: Bearer {token}` header
4. **Backend verifies token** → `extractUserIdFromRequest()` returns Firebase `uid`
5. **Query with uid** → `WHERE user_id = $1` (user_id = Firebase uid)
6. **Log action** → `INSERT INTO audit_logs (user_id, action, ...)` 

Key point: **user_id in database = Firebase UID** (not a generated number)
