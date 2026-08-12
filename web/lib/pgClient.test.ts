import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const VALID_POOLED_URL =
  'postgresql://postgres.abcdefghij:realpassword123@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

describe('getPool', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  });

  it('throws a clear error when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const { getPool } = await import('./pgClient');
    expect(() => getPool()).toThrow(/DATABASE_URL is not set/);
  });

  it('throws a clear error when DATABASE_URL is empty', async () => {
    process.env.DATABASE_URL = '   ';
    const { getPool } = await import('./pgClient');
    expect(() => getPool()).toThrow(/DATABASE_URL is not set/);
  });

  it('throws a clear error when DATABASE_URL is still the .env.example placeholder', async () => {
    process.env.DATABASE_URL =
      'postgresql://postgres:[YOUR-PASSWORD]@[PROJECT-REF].pooler.supabase.com:6543/postgres';
    const { getPool } = await import('./pgClient');
    expect(() => getPool()).toThrow(/placeholder value/);
  });

  it('throws a clear error when DATABASE_URL is malformed', async () => {
    process.env.DATABASE_URL = 'not-a-connection-string';
    const { getPool } = await import('./pgClient');
    expect(() => getPool()).toThrow(/malformed/);
  });

  it('throws a clear error when DATABASE_URL is missing the pooled port', async () => {
    process.env.DATABASE_URL = 'postgresql://user:password@host/database';
    const { getPool } = await import('./pgClient');
    expect(() => getPool()).toThrow(/malformed/);
  });

  it('does not throw at the validation stage for a plausibly-real pooled connection string', async () => {
    process.env.DATABASE_URL = VALID_POOLED_URL;
    const { getPool } = await import('./pgClient');
    expect(() => getPool()).not.toThrow();
  });

  it('returns a singleton instance on repeated calls', async () => {
    process.env.DATABASE_URL = VALID_POOLED_URL;
    const { getPool } = await import('./pgClient');
    const firstCall = getPool();
    const secondCall = getPool();
    expect(firstCall).toBe(secondCall);
  });
});
