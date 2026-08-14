// ===== BUSINESS LOGIC LAYER (HostImpactEngine) =====
import { mockDb } from '../data-access/mockDataStore.js';
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';

// "Reputation Score and Host Impact Score calculations" live here, not in
// any GUI component, so Module 6 (dispute/verification) and future modules can reuse
// the exact same weighting without duplicating logic.

const WEIGHTS = { trips: 2.0, co2: 0.5, reputation: 0.8 };

const BADGE_TIERS = [
  { name: 'Bronze Host', minScore: 0, perks: ['Standard platform fee (15%)'] },
  { name: 'Silver Host', minScore: 80, perks: ['Reduced platform fee (12%)', 'Priority support'] },
  {
    name: 'Gold Host',
    minScore: 150,
    perks: [
      'Gold verified badge',
      'Reduced platform fee (8%)',
      'Priority support',
      'Featured in host discovery'
    ]
  },
  {
    name: 'Platinum Host',
    minScore: 250,
    perks: [
      'Platinum verified badge',
      'Reduced platform fee (5%)',
      'Priority support',
      'Featured in host discovery',
      'Early access to new routes'
    ]
  }
];

function computeCompositeScore({ completedTrips, co2SavedKg, reputationScore }) {
  return completedTrips * WEIGHTS.trips + co2SavedKg * WEIGHTS.co2 + reputationScore * WEIGHTS.reputation;
}

function badgeForScore(score) {
  return [...BADGE_TIERS].reverse().find((tier) => score >= tier.minScore) || BADGE_TIERS[0];
}

// Pure helper so other business-logic modules (e.g. RideService, for the Ride Hub's
// host tier pills) can get a badge from stats they already have, without a second
// getImpactSummary fetch. Same formula, same tiers - one Host Impact Engine.
export function getBadgeForStats(stats) {
  return badgeForScore(computeCompositeScore(stats));
}

export const HostImpactEngine = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',
  weights: WEIGHTS,
  badgeTiers: BADGE_TIERS,

  async getImpactSummary(userId) {
    const stats = isSupabaseConfigured
      ? await fetchFromSupabase(userId)
      : await mockDb.getImpactStats(userId);

    const compositeScore = computeCompositeScore(stats);
    const badge = badgeForScore(compositeScore);
    const nextTier = BADGE_TIERS.find((t) => t.minScore > compositeScore);

    return {
      ...stats,
      weights: WEIGHTS,
      compositeScore: Math.round(compositeScore * 10) / 10,
      badge,
      nextTier: nextTier
        ? { ...nextTier, pointsToNext: Math.ceil(nextTier.minScore - compositeScore) }
        : null
    };
  },

  // Demo controls on the mockup ("+5 trips, +3 rep score" / "-8 trips, -12 rep score")
  // let a reviewer see badge-tier transitions live without needing real trip data.
  async applyDemoAdjustment(userId, { trips, reputation }) {
    if (isSupabaseConfigured) {
      throw new Error('Demo controls are only available against the mock backend.');
    }
    await mockDb.adjustImpactStats(userId, { trips, reputation });
    return HostImpactEngine.getImpactSummary(userId);
  }
};

async function fetchFromSupabase(userId) {
  const { data, error } = await supabase
    .from('host_impact_stats')
    .select('completed_trips, co2_saved_kg, reputation_score')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return {
    completedTrips: data.completed_trips,
    co2SavedKg: data.co2_saved_kg,
    reputationScore: data.reputation_score
  };
}
