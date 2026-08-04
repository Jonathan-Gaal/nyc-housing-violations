import { describe, expect, it } from 'vitest';
import { validateZipCode, validateBuildingId } from './validation';

describe('validateZipCode', () => {
  it('accepts a 5-digit zip', () => {
    expect(validateZipCode('11106')).toEqual({ valid: true });
  });

  it('rejects missing zip', () => {
    expect(validateZipCode(null).valid).toBe(false);
    expect(validateZipCode('').valid).toBe(false);
  });

  it('rejects non-5-digit zips', () => {
    expect(validateZipCode('1234').valid).toBe(false);
    expect(validateZipCode('123456').valid).toBe(false);
  });

  it('rejects non-numeric input, including injection attempts', () => {
    expect(validateZipCode('1110a').valid).toBe(false);
    expect(validateZipCode("11106' OR '1'='1").valid).toBe(false);
  });
});

describe('validateBuildingId', () => {
  it('accepts a non-empty id', () => {
    expect(validateBuildingId('417759')).toEqual({ valid: true });
  });

  it('rejects empty or whitespace-only ids', () => {
    expect(validateBuildingId('').valid).toBe(false);
    expect(validateBuildingId('   ').valid).toBe(false);
    expect(validateBuildingId(null).valid).toBe(false);
  });
});
