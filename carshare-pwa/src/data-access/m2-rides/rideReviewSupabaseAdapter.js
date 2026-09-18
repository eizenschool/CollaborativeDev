import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

const REVIEW_SELECT = `
  *,
  reviewer:profiles!ride_reviews_reviewer_id_fkey(id, full_name, profile_photo_url),
  reviewee:profiles!ride_reviews_reviewee_id_fkey(id, full_name, profile_photo_url),
  ride:rides(id, pickup, destination, departure_at)
`;

export const rideReviewSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  submit({ rideId, revieweeId, rating, comment }) {
    return supabase.rpc('submit_ride_review', {
      p_ride_id: rideId,
      p_reviewee_id: revieweeId,
      p_rating: rating,
      p_comment: comment
    });
  },

  getById(reviewId) {
    return supabase.from('ride_reviews').select(REVIEW_SELECT).eq('id', reviewId).single();
  },

  listByReviewee(profileId) {
    return supabase
      .from('ride_reviews')
      .select(REVIEW_SELECT)
      .eq('reviewee_id', profileId)
      .order('created_at', { ascending: false });
  },

  getEligibility(rideId) {
    return supabase.rpc('get_ride_review_eligibility', { p_ride_id: rideId });
  }
};
