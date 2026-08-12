import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';
import { getPool } from '../lib/pgClient';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');
const MIGRATION_FILENAME_PATTERN = /^(\d+)_.+\.sql$/;

interface MigrationFile {
  prefix: string;
  filename: string;
  path: string;
}

export function discoverMigrationFiles(migrationsDir: string): MigrationFile[] {
  const filenames = readdirSync(migrationsDir)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  const seenPrefixes = new Map<string, string>();
  const migrations: MigrationFile[] = [];

  for (const filename of filenames) {
    const match = filename.match(MIGRATION_FILENAME_PATTERN);
    if (!match) {
      throw new Error(
        `Migration file "${filename}" does not match the required "NNN_slug.sql" naming pattern.`
      );
    }

    const [, prefix] = match;
    const existing = seenPrefixes.get(prefix);
    if (existing) {
      throw new Error(
        `Ambiguous migration order: "${existing}" and "${filename}" share the same numeric prefix "${prefix}".`
      );
    }
    seenPrefixes.set(prefix, filename);

    migrations.push({ prefix, filename, path: join(migrationsDir, filename) });
  }

  return migrations;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrationFilenames(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

// Redacts credentials from a Postgres connection string before it is ever logged.
function redactConnectionString(connectionString: string): string {
  return connectionString.replace(/\/\/[^@]+@/, '//[redacted]@');
}

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  const databaseUrl = process.env.DATABASE_URL as string;
  console.log(`Connecting to ${redactConnectionString(databaseUrl)}`);

  await ensureMigrationsTable(pool);
  const appliedFilenames = await getAppliedMigrationFilenames(pool);

  const migrationFiles = discoverMigrationFiles(MIGRATIONS_DIR);

  for (const migration of migrationFiles) {
    if (appliedFilenames.has(migration.filename)) {
      console.log(`Skipping already-applied migration: ${migration.filename}`);
      continue;
    }

    console.log(`Applying migration: ${migration.filename}`);
    const sql = readFileSync(migration.path, 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [migration.filename]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.log(`Applied migration: ${migration.filename}`);
  }

  console.log('Migrations complete.');
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Migration failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
