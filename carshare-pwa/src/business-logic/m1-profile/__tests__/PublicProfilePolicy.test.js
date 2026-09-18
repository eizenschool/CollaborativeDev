import { describe, expect, it } from 'vitest';
import { buildPublicProfile, publicDisplayName } from '../PublicProfilePolicy.js';

describe('public profile privacy projection', () => {
  it('uses a first name and surname initial instead of the legal-style full name', () => {
    expect(publicDisplayName('Jamie Delacroix')).toBe('Jamie D.');
  });

  it('keeps trust fields while hiding owner-selected optional fields', () => {
    const profile = buildPublicProfile({
      user: { id: 'u1', fullName: 'Jamie Delacroix', status: 'active', profilePhotoUrl: '/photo.jpg', spokenLanguages: ['english'] },
      stats: { reputationScore: 78, rating: 4.9, completedTrips: 34, co2SavedKg: 287 },
      reviewCount: 12,
      visibility: { showProfilePhoto: false, showSpokenLanguages: false, showCompletedTrips: false, showEcoImpact: false }
    });
    expect(profile).toMatchObject({ displayName: 'Jamie D.', profilePhotoUrl: null, spokenLanguages: [], reputationScore: 78, rating: 4.9, reviewCount: 12, completedTrips: null, co2SavedKg: null });
  });

  it('never returns a deactivated account', () => {
    expect(buildPublicProfile({ user: { id: 'u1', fullName: 'Jamie', status: 'deactivated' } })).toBeNull();
  });
});
