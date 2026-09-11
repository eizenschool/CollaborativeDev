import { normalizeSpokenLanguages } from './CompatibilityOptions.js';

export const DEFAULT_PROFILE_VISIBILITY = Object.freeze({
  showProfilePhoto: true,
  showSpokenLanguages: true,
  showCompletedTrips: true,
  showEcoImpact: false
});

export function normalizeProfileVisibility(value = {}) {
  return {
    showProfilePhoto: value.showProfilePhoto ?? value.show_profile_photo ?? DEFAULT_PROFILE_VISIBILITY.showProfilePhoto,
    showSpokenLanguages: value.showSpokenLanguages ?? value.show_spoken_languages ?? DEFAULT_PROFILE_VISIBILITY.showSpokenLanguages,
    showCompletedTrips: value.showCompletedTrips ?? value.show_completed_trips ?? DEFAULT_PROFILE_VISIBILITY.showCompletedTrips,
    showEcoImpact: value.showEcoImpact ?? value.show_eco_impact ?? DEFAULT_PROFILE_VISIBILITY.showEcoImpact
  };
}

export function publicDisplayName(fullName = 'Member') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || 'Member';
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function buildPublicProfile({ user, stats = {}, reviewCount = 0, visibility = {} } = {}) {
  if (!user || user.status !== 'active') return null;
  const preferences = normalizeProfileVisibility(visibility);
  return {
    id: user.id,
    displayName: publicDisplayName(user.fullName ?? user.full_name),
    profilePhotoUrl: preferences.showProfilePhoto ? (user.profilePhotoUrl ?? user.profile_photo_url ?? null) : null,
    spokenLanguages: preferences.showSpokenLanguages
      ? normalizeSpokenLanguages(user.spokenLanguages ?? user.spoken_languages)
      : [],
    createdAt: user.createdAt ?? user.created_at ?? null,
    reputationScore: Number(stats.reputationScore ?? stats.reputation_score ?? 70),
    rating: stats.rating == null ? null : Number(stats.rating),
    reviewCount: Number(reviewCount || 0),
    completedTrips: preferences.showCompletedTrips ? Number(stats.completedTrips ?? stats.completed_trips ?? 0) : null,
    co2SavedKg: preferences.showEcoImpact ? Number(stats.co2SavedKg ?? stats.co2_saved_kg ?? 0) : null,
    visibility: preferences
  };
}

