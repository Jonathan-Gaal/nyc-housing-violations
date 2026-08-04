import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { getDb } from '../lib/db';
import { loadIntoDb } from '../lib/loadIntoDb';
import type { RawViolationRow } from '../lib/csvLoader';

const csvPath =
  process.argv[2] ||
  path.join(process.cwd(), '..', 'data', 'Housing_Maintenance_Code_Violations_20260803.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found at ${csvPath}`);
  process.exit(1);
}

const content = fs.readFileSync(csvPath, 'utf-8');
const rows: RawViolationRow[] = parse(content, { columns: true, skip_empty_lines: true });

console.log(`Parsed ${rows.length} rows from ${csvPath}`);

const db = getDb();
const result = loadIntoDb(db, rows);

console.log(`Loaded ${result.buildingsLoaded} buildings, ${result.violationsLoaded} violations`);

const byZip = db
  .prepare('SELECT postcode, COUNT(*) as n FROM buildings GROUP BY postcode')
  .all() as { postcode: string; n: number }[];
console.log('Buildings per zip:', byZip);
