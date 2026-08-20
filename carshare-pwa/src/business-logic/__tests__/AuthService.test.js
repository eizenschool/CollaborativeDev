import { describe, expect, it } from 'vitest';
import { validateMalaysianIC } from '../AuthService.js';

describe('validateMalaysianIC', () => {
  it('accepts a dashed 12-digit MyKad number', () => {
    expect(validateMalaysianIC('990101-14-5678')).toBe(true);
  });

  it('accepts an undashed 12-digit MyKad number', () => {
    expect(validateMalaysianIC('990101145678')).toBe(true);
  });

  it('rejects too few digits', () => {
    expect(validateMalaysianIC('990101-14-567')).toBe(false);
  });

  it('rejects too many digits', () => {
    expect(validateMalaysianIC('990101-14-56789')).toBe(false);
  });

  it('rejects letters', () => {
    expect(validateMalaysianIC('99010A-14-5678')).toBe(false);
  });

  it('rejects empty or missing input', () => {
    expect(validateMalaysianIC('')).toBe(false);
    expect(validateMalaysianIC(undefined)).toBe(false);
  });
});
