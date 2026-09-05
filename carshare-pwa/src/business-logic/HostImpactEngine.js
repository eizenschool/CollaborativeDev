// ===== BUSINESS LOGIC LAYER (HostImpactEngine) =====
import { mockDb } from '../data-access/mockDataStore.js';
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { REPUTATION_POLICY } from './ReputationPolicy.js';

// "Reputation Score and Host Impact Score calculations" live here, not in
// any GUI component, so Module 6 (dispute/verification) and future modules can reuse
// the exact same weighting without duplicating logic.

// Reputation is deliberately absent from this formula. It measures whether a
// member is trusted to host at all; Host Impact measures how much they have
// actually contributed. Since D034 every member starts at the 100 ceiling, so
// an additive reputation term would put the same ~80-point pedestal under
// everybody - it promoted brand-new accounts with zero trips straight to
// Silver. Reputation now acts as a ceiling instead (see badgeForScore).
const WEIGHTS = { trips: 2.0, co2: 0.5 };

// Recalibrated for contribution alone. The previous 0/80/150/250 thresholds
// were set when roughly 56-80 points of reputation were baked into every
// score, so they are lowered by about that much to keep the same real spread:
// ~25 trips reaches Silver, ~60 reaches Gold, ~100 reaches Platinum.
const BADGE_TIERS = [
  { name: 'Bronze Host', minScore: 0, perks: ['Standard platform fee (15%)'] },
  { name: 'Silver Host', minScore: 50, perks: ['Reduced platform fee (12%)', 'Priority support'] },
  {
    name: 'Gold Host',
    minScore: 120,
    perks: [
      'Gold verified badge',
      'Reduced platform fee (8%)',
      'Priority support',
      'Featured in host discovery'
    ]
  },
  {
    name: 'Platinum Host',
    minScore: 200,
    perks: [
      'Platinum verified badge',
      'Reduced platform fee (5%)',
      'Priority support',
      'Featured in host discovery',
      'Early access to new routes'
    ]
  }
];

export function calculateCompositeHostImpact({ completedTrips = 0, co2SavedKg = 0 } = {}) {
  const trips = Number.isFinite(Number(completedTrips)) ? Number(completedTrips) : 0;
  const co2 = Number.isFinite(Number(co2SavedKg)) ? Number(co2SavedKg) : 0;
  return trips * WEIGHTS.trips + co2 * WEIGHTS.co2;
}

// A confirmed safety hold, or a score below the Driver publishing threshold,
// withholds every tier above Bronze: past contribution should not advertise a
// member who is not currently trusted to carry anybody. An absent score is
// treated as unknown rather than restricted, so a Ride card without impact
// stats does not lose its badge - such a host has no completed trips to show
// anyway. This never raises a tier, only withholds one.
export function badgeIsWithheld({ reputationScore, reputationHold, hold } = {}) {
  if (reputationHold ?? hold) return true;
  if (reputationScore == null || reputationScore === '') return false;
  const score = Number(reputationScore);
  return Number.isFinite(score) && score > 0 && score < REPUTATION_POLICY.hostMinimum;
}

function badgeForScore(score, stats = {}) {
  if (badgeIsWithheld(stats)) return BADGE_TIERS[0];
  return [...BADGE_TIERS].reverse().find((tier) => score >= tier.minScore) || BADGE_TIERS[0];
}

// Pure helper so other business-logic modules (e.g. RideService, for the Ride Hub's
// host tier pills) can get a badge from stats they already have, without a second
// getImpactSummary fetch. Same formula, same tiers - one Host Impact Engine.
export function getBadgeForStats(stats) {
  return badgeForScore(calculateCompositeHostImpact(stats), stats);
}

export const HostImpactEngine = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',
  weights: WEIGHTS,
  badgeTiers: BADGE_TIERS,

  async getImpactSummary(userId) {
    const stats = isSupabaseConfigured
      ? await fetchFromSupabase(userId)
      : await mockDb.getImpactStats(userId);

    const compositeScore = calculateCompositeHostImpact(stats);
    const badge = badgeForScore(compositeScore, stats);
    const withheld = badgeIsWithheld(stats);
    const nextTier = BADGE_TIERS.find((t) => t.minScore > compositeScore);

    return {
      ...stats,
      weights: WEIGHTS,
      compositeScore: Math.round(compositeScore * 10) / 10,
      badge,
      badgeWithheld: withheld,
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
    .select('completed_trips, co2_saved_kg, reputation_score, reputation_hold')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return {
    completedTrips: data.completed_trips,
    co2SavedKg: data.co2_saved_kg,
    reputationScore: data.reputation_score,
    reputationHold: data.reputation_hold ?? false
  };
}
