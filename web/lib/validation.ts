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
