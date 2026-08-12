import { Pool } from 'pg';

// Matches a plausible Postgres connection string shape, e.g.
// postgresql://user:password@host:port/database
// This is a shape check only — it never attempts a network connection.
const POSTGRES_CONNECTION_STRING_PATTERN = /^postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@[^\s:/]+:\d+\/[^\s?]+/;

// Substrings that indicate the env var still holds the documented
// placeholder from .env.example rather than a real credential.
const PLACEHOLDER_MARKERS = ['YOUR-PASSWORD', 'PROJECT-REF', '[', ']'];

function assertValidDatabaseUrl(databaseUrl: string | undefined): asserts databaseUrl is string {
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error(
      'DATABASE_URL is not set. Add it to web/.env.local using the pooled Supabase ' +
        'connection string (Transaction mode, port 6543) — see web/.env.example for the shape.'
    );
  }

  if (PLACEHOLDER_MARKERS.some((marker) => databaseUrl.includes(marker))) {
    throw new Error(
      'DATABASE_URL still contains the placeholder value from web/.env.example. ' +
        'Replace it with your real Supabase pooled connection string before running this.'
    );
  }

  if (!POSTGRES_CONNECTION_STRING_PATTERN.test(databaseUrl)) {
    throw new Error(
      'DATABASE_URL is malformed. Expected a postgresql://user:password@host:port/database ' +
        'connection string (Supabase pooled connection, Transaction mode, port 6543).'
    );
  }
}

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;

  assertValidDatabaseUrl(process.env.DATABASE_URL);

  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}
