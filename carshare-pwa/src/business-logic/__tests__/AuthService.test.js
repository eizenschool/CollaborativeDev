import { describe, expect, it } from 'vitest';
import { buildSessionUser, validateMalaysianIC } from '../AuthService.js';

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

describe('buildSessionUser', () => {
  it('creates a usable shell user directly from the INITIAL_SESSION payload', () => {
    expect(buildSessionUser({
      id: 'user-1',
      email: 'alex@example.com',
      created_at: '2026-08-27T00:00:00.000Z',
      user_metadata: { full_name: 'Alex Tan', avatar_url: 'https://example.com/avatar.png' }
    })).toEqual({
      id: 'user-1',
      fullName: 'Alex Tan',
      spokenLanguages: [],
      email: 'alex@example.com',
      phone: '',
      emergencyContact: { name: '', phone: '', relationship: '' },
      profilePhotoUrl: 'https://example.com/avatar.png',
      status: 'active',
      createdAt: '2026-08-27T00:00:00.000Z'
    });
  });

  it('falls back to the email name and safely handles a missing session user', () => {
    expect(buildSessionUser({ id: 'user-2', email: 'jo@example.com' }).fullName).toBe('jo');
    expect(buildSessionUser(null)).toBeNull();
  });
});
