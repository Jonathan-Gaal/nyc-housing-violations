import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { getPool } from '../lib/pgClient';
import { loadIntoDb } from '../lib/loadIntoDb';
import type { RawViolationRow } from '../lib/csvLoader';

async function main(): Promise<void> {
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

  const pool = getPool();
  const result = await loadIntoDb(pool, rows);

  console.log(`Loaded ${result.buildingsLoaded} buildings, ${result.violationsLoaded} violations`);

  const byZipResult = await pool.query<{ postcode: string; n: string }>(
    'SELECT postcode, COUNT(*) as n FROM buildings GROUP BY postcode'
  );
  console.log(
    'Buildings per zip:',
    byZipResult.rows.map((r) => ({ postcode: r.postcode, n: Number(r.n) }))
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Load failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
