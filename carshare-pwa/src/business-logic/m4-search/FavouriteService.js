import { favouriteSupabaseAdapter } from '../../data-access/m4-search/favouriteSupabaseAdapter.js';
import '../shared/fixture/legacyMockDb.js';
import { favouriteMockAdapter } from '../../data-access/m4-search/favouriteMockAdapter.js';
import { attachDestinationPhotoPlaceIds, mapRideRow } from '../m2-rides/RideService.js';

function favouriteError(error) {
  if (!error) return null;
  const message = error.message?.replace(/^.*?: /, '') || 'Favourites could not be updated.';
  return Object.assign(new Error(message), { code: error.code });
}

export function isFavouriteRideAvailable(ride) {
  return ride?.status === 'Published' && Number(ride.seatsAvailable) > 0;
}

export function mapFavouriteRideRow(row) {
  const ride = mapRideRow({
    id: row.ride_id,
    host_id: row.host_id,
    pickup: row.pickup,
    destination: row.destination,
    departure_at: row.departure_at,
    journey_scale: row.journey_scale,
    vehicle_type: row.vehicle_type,
    seats_total: row.seats_total,
    seats_available: row.seats_available,
    contribution: row.contribution,
    restriction_tags: row.restriction_tags,
    status: row.status,
    host: row.host_id ? {
      id: row.host_id,
      full_name: row.host_full_name,
      profile_photo_url: row.host_profile_photo_url,
      spoken_languages: row.host_spoken_languages,
      host_impact_stats: {
        completed_trips: row.host_completed_trips,
        co2_saved_kg: row.host_co2_saved_kg,
        reputation_score: row.host_reputation_score,
        rating: row.host_rating
      }
    } : null
  });
  return {
    ...ride,
    favouritedAt: row.favourited_at,
    favouriteAvailable: isFavouriteRideAvailable(ride)
  };
}

export const FavouriteService = {
  backend: favouriteSupabaseAdapter.isConfigured ? 'supabase' : 'mock',

  async list(userId) {
    if (!userId) throw new Error('Sign in to view your favourite rides.');
    if (favouriteSupabaseAdapter.isConfigured) {
      try {
        return attachDestinationPhotoPlaceIds((await favouriteSupabaseAdapter.list()).map(mapFavouriteRideRow));
      } catch (error) {
        throw favouriteError(error);
      }
    }
    return attachDestinationPhotoPlaceIds(await favouriteMockAdapter.list(userId));
  },

  async add(userId, rideId) {
    if (!userId) throw new Error('Sign in to save this ride.');
    if (!rideId) throw new Error('Choose a ride to save.');
    if (favouriteSupabaseAdapter.isConfigured) {
      try { await favouriteSupabaseAdapter.add(rideId); }
      catch (error) { throw favouriteError(error); }
      return true;
    }
    return favouriteMockAdapter.add(userId, rideId);
  },

  async remove(userId, rideId) {
    if (!userId) throw new Error('Sign in to update your favourite rides.');
    if (!rideId) throw new Error('Choose a ride to remove.');
    if (favouriteSupabaseAdapter.isConfigured) {
      try { await favouriteSupabaseAdapter.remove(rideId); }
      catch (error) { throw favouriteError(error); }
      return true;
    }
    return favouriteMockAdapter.remove(userId, rideId);
  }
};
