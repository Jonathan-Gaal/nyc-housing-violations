import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildQueryUrl, fetchOpenViolations, isValidSocrataRow, type SocrataViolationRow } from './socrata';

const VALID_ZIP = '11106';

function makeRow(overrides: Partial<SocrataViolationRow> = {}): SocrataViolationRow {
  return {
    violationid: '1',
    buildingid: 'B1',
    lowhousenumber: '14-31',
    highhousenumber: '14-31',
    streetname: '31 ROAD',
    zip: VALID_ZIP,
    inspectiondate: '2026-07-01',
    novdescription: 'Heat inadequate',
    currentstatus: 'NOT COMPLIED WITH',
    novtype: 'HEAT',
    violationstatus: 'Open',
    rentimpairing: 'N',
    latitude: '40.7614',
    longitude: '-73.9776',
    bin: 'BIN1',
    bbl: 'BBL1',
    ...overrides,
  };
}

describe('buildQueryUrl', () => {
  it('always contains the hardcoded OPEN clause regardless of input', () => {
    const url = buildQueryUrl({ zip: VALID_ZIP });
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("upper(`violationstatus`) LIKE '%OPEN%'");
  });

  it('the OPEN filter cannot be overridden by any caller argument', () => {
    // buildQueryUrl's options type only accepts zip/limit/offset — there is
    // no status parameter to pass. Assert the invariant holds across a
    // range of zip inputs, proving OPEN is baked in independent of input.
    const zips = ['10001', '11106', '00501', '99999'];
    for (const zip of zips) {
      const url = buildQueryUrl({ zip });
      expect(decodeURIComponent(url)).toContain("upper(`violationstatus`) LIKE '%OPEN%'");
    }
  });

  it('throws on an invalid zip before producing a URL', () => {
    expect(() => buildQueryUrl({ zip: 'not-a-zip' })).toThrow(/Invalid zip/);
    expect(() => buildQueryUrl({ zip: '1234' })).toThrow(/Invalid zip/);
    expect(() => buildQueryUrl({ zip: '123456' })).toThrow(/Invalid zip/);
  });

  it('interpolates the validated zip into the WHERE clause', () => {
    const url = buildQueryUrl({ zip: VALID_ZIP });
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain(`upper(\`zip\`) LIKE '%${VALID_ZIP}%'`);
  });
});

describe('fetchOpenViolations', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws on an invalid zip and never calls fetch', async () => {
    await expect(fetchOpenViolations('bad-zip')).rejects.toThrow(/Invalid zip/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a zip with the wrong number of digits before any fetch call', async () => {
    await expect(fetchOpenViolations('123')).rejects.toThrow(/Invalid zip/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('loops pagination until a page returns fewer than pageSize rows', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => makeRow({ violationid: `full-${i}` }));
    const shortPage = [makeRow({ violationid: 'short-0' }), makeRow({ violationid: 'short-1' })];

    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => fullPage, text: async () => '' })
      .mockResolvedValueOnce({ ok: true, json: async () => shortPage, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchOpenViolations(VALID_ZIP);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1002);

    // Second call's offset must reflect pagination advancing by pageSize.
    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(decodeURIComponent(secondCallUrl)).toContain('OFFSET 1000');
  });

  it('stops after a single short page (no second request)', async () => {
    const shortPage = [makeRow()];
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => shortPage,
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchOpenViolations(VALID_ZIP);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it('sends the app token via header, never in the URL', async () => {
    const originalToken = process.env.NYC_APP_TOKEN;
    process.env.NYC_APP_TOKEN = 'secret-token-value';

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchOpenViolations(VALID_ZIP);

    const [calledUrl, calledOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).not.toContain('secret-token-value');
    expect((calledOptions.headers as Record<string, string>)['X-App-Token']).toBe('secret-token-value');

    process.env.NYC_APP_TOKEN = originalToken;
  });
});

describe('isValidSocrataRow', () => {
  it('accepts a row with all required fields present and non-empty', () => {
    expect(isValidSocrataRow(makeRow())).toBe(true);
  });

  it('rejects a row missing a required field (schema drift)', () => {
    const drifted = makeRow();
    // @ts-expect-error simulating a Socrata column rename/removal upstream
    delete drifted.novdescription;
    expect(isValidSocrataRow(drifted)).toBe(false);
  });

  it('rejects a row with an empty-string required field', () => {
    expect(isValidSocrataRow(makeRow({ bbl: '' }))).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isValidSocrataRow(null)).toBe(false);
    expect(isValidSocrataRow('not-a-row')).toBe(false);
    expect(isValidSocrataRow(42)).toBe(false);
  });
});
