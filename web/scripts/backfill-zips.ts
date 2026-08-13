// One-time backfill: seeds every NYC zip that currently has open HPD
// violations, so a user's first search of any real NYC zip is served from
// Postgres (instant) instead of falling back to a live, capped Socrata
// fetch. This is the "pre-warm the cache" answer to the live-search path
// being inherently bounded by Socrata's own latency (see lib/socrata.ts).
//
// Zip list pulled from a DISTINCT query against the live dataset itself
// (SELECT DISTINCT zip WHERE upper(violationstatus) LIKE '%OPEN%'),
// filtered to this app's own 5-digit zip format — the raw dataset has a
// handful of malformed zip values ('0', '111010', '1901', etc.) that this
// filter already excludes app-wide via lib/validation.ts.
//
// The cron sync route (app/api/cron/sync/route.ts) takes over daily
// refreshes once a zip is seeded — this script only needs to run once.
import { getPool } from '../lib/pgClient';
import { fetchAndLoadZip } from '../lib/socrata';

const NYC_ZIPS = [
  '10001', '10002', '10003', '10004', '10005', '10006', '10007', '10009', '10010',
  '10011', '10012', '10013', '10014', '10016', '10017', '10018', '10019', '10021',
  '10022', '10023', '10024', '10025', '10026', '10027', '10028', '10029', '10030',
  '10031', '10032', '10033', '10034', '10035', '10036', '10037', '10038', '10039',
  '10040', '10044', '10065', '10069', '10075', '10112', '10128', '10129', '10280',
  '10282', '10301', '10302', '10303', '10304', '10305', '10306', '10307', '10308',
  '10309', '10310', '10312', '10314', '10325', '10368', '10435', '10451', '10452',
  '10453', '10454', '10455', '10456', '10457', '10458', '10459', '10460', '10461',
  '10462', '10463', '10464', '10465', '10466', '10467', '10468', '10469', '10470',
  '10471', '10472', '10473', '10474', '10475', '11001', '11004', '11005', '11040',
  '11101', '11102', '11103', '11104', '11105', '11106', '11109', '11201', '11203',
  '11204', '11205', '11206', '11207', '11208', '11209', '11210', '11211', '11212',
  '11213', '11214', '11215', '11216', '11217', '11218', '11219', '11220', '11221',
  '11222', '11223', '11224', '11225', '11226', '11228', '11229', '11230', '11231',
  '11232', '11233', '11234', '11235', '11236', '11237', '11238', '11239', '11249',
  '11354', '11355', '11356', '11357', '11358', '11360', '11361', '11362', '11363',
  '11364', '11365', '11366', '11367', '11368', '11369', '11370', '11372', '11373',
  '11374', '11375', '11377', '11378', '11379', '11385', '11411', '11412', '11413',
  '11414', '11415', '11416', '11417', '11418', '11419', '11420', '11421', '11422',
  '11423', '11426', '11427', '11428', '11429', '11432', '11433', '11434', '11435',
  '11436', '11452', '11691', '11692', '11693', '11694', '11697', '12238',
];

async function main(): Promise<void> {
  const pool = getPool();

  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, zip] of NYC_ZIPS.entries()) {
    const existing = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM buildings WHERE postcode = $1',
      [zip]
    );
    if (Number(existing.rows[0].count) > 0) {
      console.log(`[${i + 1}/${NYC_ZIPS.length}] ${zip}: already seeded, skipping`);
      skipped += 1;
      continue;
    }

    try {
      const start = Date.now();
      const result = await fetchAndLoadZip(pool, zip);
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[${i + 1}/${NYC_ZIPS.length}] ${zip}: loaded ${result.buildingsLoaded} buildings, ` +
          `${result.violationsLoaded} violations in ${seconds}s`
      );
      seeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${i + 1}/${NYC_ZIPS.length}] ${zip}: FAILED — ${message}`);
      failed += 1;
    }
  }

  console.log(`\nDone. Seeded ${seeded}, skipped ${skipped} (already seeded), failed ${failed}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
