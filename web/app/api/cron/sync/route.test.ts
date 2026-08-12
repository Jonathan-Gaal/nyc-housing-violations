import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Not declared in specs/008-socrata-live-fetch-cron.md's Files list (5, "at
// cap": socrata.ts, socrata.test.ts, route.ts, vercel.json, .env.example).
// Added anyway to cover the explicitly-required CRON_SECRET 401 assertion
// (call the handler directly with a missing/wrong header, assert 401 and
// that Socrata/DB were never touched) — see log.md's 2026-08-12 spec-gap
// entry for the full justification.

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/sync', { headers });
}

describe('GET /api/cron/sync', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'test-cron-secret';
    // A syntactically valid (but unreachable) connection string so any
    // accidental getPool() call would not throw for an unrelated reason —
    // the assertion below is that getPool is never even invoked.
    process.env.DATABASE_URL =
      'postgresql://postgres:realpassword@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/pgClient');
    vi.doUnmock('@/lib/socrata');
  });

  it('returns 401 and never touches Socrata or the DB when the header is missing', async () => {
    const getPoolMock = vi.fn();
    const fetchOpenViolationsMock = vi.fn();
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));
    vi.doMock('@/lib/socrata', () => ({
      fetchOpenViolations: fetchOpenViolationsMock,
      isValidSocrataRow: vi.fn(),
    }));

    const { GET } = await import('./route');
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(fetchOpenViolationsMock).not.toHaveBeenCalled();
  });

  it('returns 401 and never touches Socrata or the DB when the secret is wrong', async () => {
    const getPoolMock = vi.fn();
    const fetchOpenViolationsMock = vi.fn();
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));
    vi.doMock('@/lib/socrata', () => ({
      fetchOpenViolations: fetchOpenViolationsMock,
      isValidSocrataRow: vi.fn(),
    }));

    const { GET } = await import('./route');
    const response = await GET(makeRequest({ authorization: 'Bearer wrong-secret' }));

    expect(response.status).toBe(401);
    expect(getPoolMock).not.toHaveBeenCalled();
    expect(fetchOpenViolationsMock).not.toHaveBeenCalled();
  });

  it('returns 401 when CRON_SECRET is not configured at all', async () => {
    delete process.env.CRON_SECRET;
    const getPoolMock = vi.fn();
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));
    vi.doMock('@/lib/socrata', () => ({
      fetchOpenViolations: vi.fn(),
      isValidSocrataRow: vi.fn(),
    }));

    const { GET } = await import('./route');
    const response = await GET(makeRequest({ authorization: 'Bearer anything' }));

    expect(response.status).toBe(401);
    expect(getPoolMock).not.toHaveBeenCalled();
  });

  it('proceeds to sync when the bearer token matches CRON_SECRET', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const getPoolMock = vi.fn().mockReturnValue({ query: queryMock });
    const fetchOpenViolationsMock = vi.fn();
    vi.doMock('@/lib/pgClient', () => ({ getPool: getPoolMock }));
    vi.doMock('@/lib/socrata', () => ({
      fetchOpenViolations: fetchOpenViolationsMock,
      isValidSocrataRow: vi.fn(),
    }));

    const { GET } = await import('./route');
    const response = await GET(makeRequest({ authorization: 'Bearer test-cron-secret' }));

    expect(response.status).toBe(200);
    expect(getPoolMock).toHaveBeenCalledTimes(1);
    // No zips loaded in this mocked DB, so fetchOpenViolations should never
    // fire — proves authorization succeeded and control reached the sync
    // loop rather than proving anything about pagination (covered in
    // socrata.test.ts).
    expect(fetchOpenViolationsMock).not.toHaveBeenCalled();

    const body = (await response.json()) as { syncedZips: number };
    expect(body.syncedZips).toBe(0);
  });
});
