// ===== DATA ACCESS LAYER (Supabase discovery repository) =====
// This adapter is opt-in through VITE_DISCOVERY_DATA_SOURCE=supabase. Keeping
// the switch explicit preserves the offline fixture used by tests and demos
// until migration 024 and the public/authenticated access decision are ready.

import { supabase } from './supabaseClient.js';

const PLACE_SELECT = [
  'id', 'source_place_id', 'name', 'category', 'description',
  'description_is_template', 'rating', 'review_count', 'lat', 'lng', 'state',
  'photo_references', 'reviews', 'lifecycle_state', 'state_before_demotion',
  'absence_counter', 'last_seen_at', 'created_at', 'updated_at'
].join(',');

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured for live discovery.');
  return supabase;
}

function mapPlace(row) {
  return {
    id: row.id,
    sourcePlaceId: row.source_place_id,
    name: row.name,
    category: row.category,
    description: row.description || '',
    descriptionIsTemplate: row.description_is_template,
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: Number(row.review_count) || 0,
    lat: Number(row.lat),
    lng: Number(row.lng),
    state: row.state || '',
    photoReferences: Array.isArray(row.photo_references) ? row.photo_references : [],
    lifecycleState: row.lifecycle_state,
    stateBeforeDemotion: row.state_before_demotion,
    absenceCounter: Number(row.absence_counter) || 0,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Enrichment stores up to five reviews, each with the author attribution
    // under which the text may be shown at all. Guarded because the column was
    // added in 025: a row written before that migration has no reviews key.
    reviews: Array.isArray(row.reviews)
      ? row.reviews.map((review) => ({
        author: review?.author || '',
        rating: typeof review?.rating === 'number' ? review.rating : null,
        text: review?.text || ''
      })).filter((review) => review.author && review.text)
      : [],
    // These fixture-only fields deliberately remain empty for live rows. The
    // shared discovery contract does not expose them to Modules 2 or 4.
    rideDestinationAliases: [],
    travelNote: '',
    vm2026Event: null
  };
}

function mapRegistration(row) {
  return {
    id: row.id,
    userId: row.user_id,
    placeId: row.place_id,
    travelDate: row.travel_date,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at
  };
}

export const liveDiscoveryDb = {
  async listPlaces() {
    const client = requireClient();
    const { data, error } = await client
      .from('places')
      .select(PLACE_SELECT)
      .in('lifecycle_state', ['Active', 'Provisional', 'Stale']);
    if (error) throw error;
    return (data || []).map(mapPlace);
  },

  async getPlace(placeId) {
    const client = requireClient();
    const { data, error } = await client
      .from('places')
      .select(PLACE_SELECT)
      .eq('id', placeId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPlace(data) : null;
  },

  async recordInterest(userId, placeId, travelDate) {
    if (!userId || !placeId || !travelDate) return { recorded: false };
    const client = requireClient();
    const { data, error } = await client
      .from('place_interest')
      .upsert(
        { user_id: userId, place_id: placeId, travel_date: travelDate },
        { onConflict: 'user_id,place_id,travel_date', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return { recorded: Boolean(data) };
  },

  async latentDemand(travelDate) {
    if (!travelDate) return new Map();
    const client = requireClient();
    const { data, error } = await client.rpc('place_latent_demand', {
      p_travel_date: travelDate
    });
    if (error) throw error;
    return new Map((data || []).map((row) => [row.place_id, Number(row.interested_users) || 0]));
  },

  async getPreferences(userId) {
    if (!userId) return null;
    const client = requireClient();
    const { data, error } = await client
      .from('user_travel_preferences')
      .select('preferred_categories,prompt_dismissed')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data
      ? { preferredCategories: data.preferred_categories || [], promptDismissed: data.prompt_dismissed }
      : null;
  },

  async savePreferences(userId, { preferredCategories = [], promptDismissed = false } = {}) {
    const client = requireClient();
    const { data, error } = await client
      .from('user_travel_preferences')
      .upsert({
        user_id: userId,
        preferred_categories: preferredCategories,
        prompt_dismissed: promptDismissed,
        updated_at: new Date().toISOString()
      })
      .select('preferred_categories,prompt_dismissed')
      .single();
    if (error) throw error;
    return {
      preferredCategories: data.preferred_categories || [],
      promptDismissed: data.prompt_dismissed
    };
  },

  async registerForNotification(userId, placeId, travelDate) {
    const client = requireClient();
    const { data, error } = await client
      .from('ride_notify_registration')
      .upsert(
        { user_id: userId, place_id: placeId, travel_date: travelDate, status: 'active' },
        { onConflict: 'user_id,place_id,travel_date', ignoreDuplicates: true }
      )
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return { registration: data ? mapRegistration(data) : null, alreadyExisted: !data };
  },

  async listRegistrations(userId) {
    const client = requireClient();
    const { data, error } = await client
      .from('ride_notify_registration')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRegistration);
  },

  async cancelRegistration(userId, registrationId) {
    const client = requireClient();
    const { data, error } = await client
      .from('ride_notify_registration')
      .update({ status: 'cancelled', closed_at: new Date().toISOString() })
      .eq('id', registrationId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRegistration(data) : null;
  },

  __reset() {
    throw new Error('Live discovery data cannot be reset from the browser.');
  }
};
