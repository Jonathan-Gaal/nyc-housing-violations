export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// Zip is the only dynamic filter accepted anywhere in this app — see
// context/API_INTEGRATION.md. Validate before it touches any query.
export function validateZipCode(zip: string | null | undefined): ValidationResult {
  if (!zip) {
    return { valid: false, error: 'Zip code is required' };
  }
  if (!/^\d{5}$/.test(zip)) {
    return { valid: false, error: 'Zip code must be 5 digits' };
  }
  return { valid: true };
}

export function validateBuildingId(id: string | null | undefined): ValidationResult {
  if (!id || id.trim().length === 0) {
    return { valid: false, error: 'Building ID is required' };
  }
  return { valid: true };
}

// Street/address search text — unlike the zip filter, this reaches a
// Postgres ILIKE, not a Socrata SoQL string (see lib/queries.ts's
// searchBuildingsByAddress), so it's parameterized rather than
// pattern-matched here. Still bounded so an empty or absurdly long query
// can't force a full-table scan.
export function validateSearchQuery(q: string | null | undefined): ValidationResult {
  const trimmed = (q ?? '').trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Enter a zip code, street, or address' };
  }
  if (trimmed.length < 3) {
    return { valid: false, error: 'Search must be at least 3 characters' };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: 'Search is too long' };
  }
  return { valid: true };
}

// Escapes ILIKE wildcard characters in user-supplied search text so a
// literal "%" or "_" in an address is matched literally, not as a SQL
// wildcard. Postgres's default LIKE/ILIKE escape character is backslash,
// so no explicit ESCAPE clause is needed alongside this.
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
