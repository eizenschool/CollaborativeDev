// ===== BUSINESS LOGIC LAYER (RideReviewService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

const REVIEW_SELECT = `
  *,
  reviewer:profiles!ride_reviews_reviewer_id_fkey(id, full_name, profile_photo_url),
  reviewee:profiles!ride_reviews_reviewee_id_fkey(id, full_name, profile_photo_url),
  ride:rides(id, pickup, destination, departure_at)
`;

function normalizeError(error) {
  return Object.assign(new Error(error?.message?.replace(/^.*?: /, '') || 'The review could not be processed.'), { code: error?.code });
}

export function validateRideReview({ rating, comment = '' }) {
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new Error('Choose a rating from 1 to 5 stars.');
  }
  if (comment.length > 500) throw new Error('Review comments are limited to 500 characters.');
  return { rating: stars, comment: comment.trim() };
}

function mapReview(row) {
  return {
    id: row.id,
    rideId: row.ride_id ?? row.rideId,
    reviewerId: row.reviewer_id ?? row.reviewerId,
    revieweeId: row.reviewee_id ?? row.revieweeId,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at ?? row.createdAt,
    reviewer: row.reviewer ? {
      id: row.reviewer.id,
      fullName: row.reviewer.full_name ?? row.reviewer.fullName,
      profilePhotoUrl: row.reviewer.profile_photo_url ?? row.reviewer.profilePhotoUrl
    } : null,
    reviewee: row.reviewee ? {
      id: row.reviewee.id,
      fullName: row.reviewee.full_name ?? row.reviewee.fullName,
      profilePhotoUrl: row.reviewee.profile_photo_url ?? row.reviewee.profilePhotoUrl
    } : null,
    ride: row.ride ? {
      id: row.ride.id,
      pickup: row.ride.pickup,
      destination: row.ride.destination,
      departureAt: row.ride.departure_at ?? row.ride.departureAt
    } : null
  };
}

export const RideReviewService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async submitReview(reviewerId, { rideId, revieweeId, rating, comment = '' }) {
    const review = validateRideReview({ rating, comment });
    if (isSupabaseConfigured) {
      const { data: reviewId, error } = await supabase.rpc('submit_ride_review', {
        p_ride_id: rideId,
        p_reviewee_id: revieweeId,
        p_rating: review.rating,
        p_comment: review.comment
      });
      if (error) throw normalizeError(error);
      const { data, error: readError } = await supabase.from('ride_reviews').select(REVIEW_SELECT).eq('id', reviewId).single();
      if (readError) throw normalizeError(readError);
      return mapReview(data);
    }
    return mockDb.submitRideReview(reviewerId, { rideId, revieweeId, ...review });
  },

  async listProfileReviews(profileId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('ride_reviews')
        .select(REVIEW_SELECT)
        .eq('reviewee_id', profileId)
        .order('created_at', { ascending: false });
      if (error) throw normalizeError(error);
      return data.map(mapReview);
    }
    return mockDb.listProfileReviews(profileId);
  },

  async getEligibility(reviewerId, rideId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.rpc('get_ride_review_eligibility', { p_ride_id: rideId });
      if (error) throw normalizeError(error);
      return data.map((item) => ({
        revieweeId: item.reviewee_id,
        revieweeName: item.reviewee_name,
        revieweeAvatarUrl: item.reviewee_avatar_url,
        reviewerRole: item.reviewer_role,
        existingRating: item.existing_rating,
        existingComment: item.existing_comment,
        reviewedAt: item.reviewed_at
      }));
    }
    return mockDb.getRideReviewEligibility(reviewerId, rideId);
  }
};
