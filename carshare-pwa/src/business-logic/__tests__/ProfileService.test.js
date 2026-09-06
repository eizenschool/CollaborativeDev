import { describe, expect, it, vi } from 'vitest';

vi.mock('../../data-access/supabaseClient.js', () => ({
  isSupabaseConfigured: false,
  supabase: null
}));

// The mock backend persists through localStorage, which the node test
// environment does not provide - same shim other business-logic tests use.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const { AuthService } = await import('../AuthService.js');
const {
  canonicalMalaysianPhone,
  ProfileService,
  validateMalaysianPhone
} = await import('../ProfileService.js');

describe('UC1.11 active-obligations check (deactivate account)', () => {
  it('blocks a host with an active Published ride', async () => {
    // u_demo_1 is seeded with r_5, a Published ride it hosts.
    await expect(ProfileService.assertNoActiveObligations('u_demo_1')).rejects.toMatchObject({
      code: 'ACCOUNT_HAS_ACTIVE_OBLIGATIONS'
    });
  });

  it('allows a member with no active ride or request', async () => {
    // u_demo_2 is seeded with no rides and no ride requests.
    await expect(ProfileService.assertNoActiveObligations('u_demo_2')).resolves.toBeUndefined();
  });

  it('blocks deactivation itself before ever checking the password', async () => {
    await expect(
      ProfileService.deactivateAccount('u_demo_1', { currentPassword: 'irrelevant' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_HAS_ACTIVE_OBLIGATIONS' });
  });
});

describe('UC1.11 credential re-verification (deactivate account)', () => {
  it('rejects deactivation with an incorrect password', async () => {
    const { user } = await AuthService.signUp({
      fullName: 'Deactivate Test',
      email: 'deactivate-test@example.com',
      password: 'Password123'
    });

    await expect(
      ProfileService.deactivateAccount(user.id, { currentPassword: 'x' })
    ).rejects.toThrow(/current password is incorrect/i);
  });

  it('deactivates once the correct password is confirmed and no obligations exist', async () => {
    const { user } = await AuthService.signUp({
      fullName: 'Deactivate Test Two',
      email: 'deactivate-test-two@example.com',
      password: 'Password123'
    });

    await expect(
      ProfileService.deactivateAccount(user.id, { currentPassword: 'Password123' })
    ).resolves.toBe(true);

    const profile = await ProfileService.getProfile(user.id);
    expect(profile.status).toBe('deactivated');
  });
});

describe('UC1.10 emergency contact phone validation', () => {
  it('accepts local and international Malaysian phone formats', () => {
    expect(validateMalaysianPhone('012-345 6789')).toBe(true);
    expect(validateMalaysianPhone('+60 19-876 5432')).toBe(true);
    expect(validateMalaysianPhone('0104507792')).toBe(true);
  });

  it('rejects an obviously malformed number', () => {
    expect(validateMalaysianPhone('12345')).toBe(false);
    expect(validateMalaysianPhone('not a phone number')).toBe(false);
    expect(validateMalaysianPhone('')).toBe(false);
  });

  it('treats the local and international spelling of the same number as equal', () => {
    expect(canonicalMalaysianPhone('012-345 6789')).toBe(canonicalMalaysianPhone('+60123456789'));
  });

  it('rejects a malformed phone number before it reaches the database', async () => {
    await expect(
      ProfileService.updateEmergencyContact('u_demo_2', { name: 'Alex', phone: '123', relationship: 'Friend' })
    ).rejects.toThrow(/valid phone number/i);
  });

  it('refuses an emergency contact that is the member\'s own phone number', async () => {
    await expect(
      ProfileService.updateEmergencyContact(
        'u_demo_2',
        { name: 'Myself', phone: '012-345 6789', relationship: 'Self' },
        { ownPhone: '+60123456789' }
      )
    ).rejects.toThrow(/cannot be your own phone number/i);
  });

  it('saves a valid, distinct emergency contact', async () => {
    const updated = await ProfileService.updateEmergencyContact(
      'u_demo_2',
      { name: 'Alex Delacroix', phone: '012-345 6789', relationship: 'Spouse' },
      { ownPhone: '019-876 5432' }
    );
    expect(updated.emergencyContact).toMatchObject({ name: 'Alex Delacroix', phone: '012-345 6789' });
  });
});
