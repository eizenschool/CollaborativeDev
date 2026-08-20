// ===== BUSINESS LOGIC LAYER (DiscoveryContractAdapter) =====
//
// THE ONLY FILE IN DESTINATION DISCOVERY THAT IMPORTS ANOTHER MODULE'S CODE.
//
// This module reads from two others and writes to neither:
//   - Module 2 (RideService) for published rides, which is where the
//     seat-headroom signal comes from.
//   - Module 5 (TripHistoryEngine) for completed trips, which is where personal
//     affinity comes from when a user has history.
//
// Both were agreed as read-only reads in the module change impact list.
// Funnelling them through one adapter means that when either module reshapes its
// return values, this file changes and nothing else in Destination Discovery does.
//
// Strictly read-only: nothing here publishes, edits, or cancels a ride, and
// nothing writes to Module 5's records.

import { RideService } from '../RideService.js';
import { TripHistoryEngine } from '../TripHistoryEngine.js';

/** Lowercase, strip punctuation and whitespace, so "George Town" == "Georgetown". */
function normalise(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Does a ride's free-text destination refer to this catalogue place?
 *
 * Matching is by text because Module 2 stores a typed destination string while
 * the catalogue stores a place record - there is no shared key yet. Places carry
 * explicit `rideDestinationAliases` for the cases text alone cannot bridge
 * ("Georgetown, Penang" as typed by a Host vs "George Town Heritage Core" as
 * named by the source).
 *
 * This whole function disappears once ingestion is live: both sides will carry
 * the same Google Place ID and this becomes an equality check. It is confined to
 * the adapter precisely so that swap touches one file.
 */
export function referencesPlace(rideDestination, place) {
  const destination = normalise(rideDestination);
  if (!destination) return false;

  const candidates = [place.name, ...(place.rideDestinationAliases || [])].map(normalise);
  return candidates.some((candidate) =>
    candidate && (destination.includes(candidate) || candidate.includes(destination))
  );
}

/**
 * Every currently published ride, normalised.
 *
 * Deliberately unfiltered by date. Module 2's search does an exact `date ===`
 * match, so asking it for one day would hide every ride on the days either side
 * and make the served list look empty whenever the user's chosen date happens to
 * have no departures. The travel-window comparison belongs to this module and is
 * applied by `getRidesByPlace` instead.
 */
export async function getPublishedRides() {
  try {
    const rides = await RideService.searchRides({}) || [];
    return rides.map((ride) => ({
      id: ride.id,
      destination: ride.destination,
      date: ride.date,
      seatsTotal: Number(ride.seatsTotal ?? 0),
      seatsAvailable: Number(ride.seatsAvailable ?? 0),
      departureAt: ride.departureAt ?? null,
      hostName: ride.host?.fullName ?? ride.host?.full_name ?? null
    }));
  } catch {
    // A ride-search failure must not take the discovery view down with it. No
    // rides means every candidate scores 0 on seat headroom, which is exactly
    // what "nobody is driving there" is supposed to look like.
    return [];
  }
}

/** The rides serving each place on a given travel date, keyed by place id. */
export function getRidesByPlace(places = [], rides = [], travelDate) {
  const byPlace = new Map();
  for (const place of places) {
    const serving = rides.filter(
      (ride) => (!travelDate || ride.date === travelDate) && referencesPlace(ride.destination, place)
    );
    if (serving.length) byPlace.set(place.id, serving);
  }
  return byPlace;
}

/** Dates that actually have departures, ascending. Lets the UI open on a useful day. */
export function departureDates(rides = []) {
  return [...new Set(rides.map((r) => r.date).filter(Boolean))].sort();
}

/**
 * The user's completed trips, normalised to the `{ category }` shape
 * AffinityResolver expects.
 *
 * Module 5 records a destination but not a destination *category*, so a trip is
 * matched back to the catalogue to recover one. Trips that match no catalogue
 * place are dropped rather than guessed: an unmatched trip is absent evidence,
 * and inventing a category would bias affinity toward whichever category the
 * guess favoured.
 */
export async function getCompletedTripCategories(userId, places = []) {
  if (!userId) return [];

  let history = [];
  try {
    history = await TripHistoryEngine.listHistory(userId) || [];
  } catch {
    // No history is a legitimate state - AffinityResolver falls through to
    // stated preferences, then to neutral.
    return [];
  }

  return history
    .filter((trip) => String(trip?.status || '').toLowerCase() === 'completed')
    .map((trip) => {
      const place = places.find((p) => referencesPlace(trip.destination, p));
      return place ? { category: place.category } : null;
    })
    .filter(Boolean);
}

/**
 * Where this Host has published rides to before, as a single coordinate.
 *
 * UC6.7 ranks unmet demand partly by "proximity to the host's previous
 * publishing pattern". Module 2 stores a destination string rather than a
 * coordinate, so the pattern is recovered by matching those strings back to the
 * catalogue and averaging the coordinates of whatever matched.
 *
 * Returns null rather than a guess when nothing matches. A Host with no usable
 * history is ranked on demand alone, which is the right answer - inventing an
 * anchor would silently reorder their list around a place they have never been.
 */
export async function getHostPublishingAnchor(userId, places = []) {
  if (!userId) return null;

  let hosted = [];
  try {
    const history = await TripHistoryEngine.listHistory(userId) || [];
    hosted = history.filter((trip) => trip?.role === 'Host');
  } catch {
    return null;
  }

  const matched = hosted
    .map((trip) => places.find((place) => referencesPlace(trip.destination, place)))
    .filter(Boolean);

  if (matched.length === 0) return null;

  return {
    lat: matched.reduce((sum, p) => sum + p.lat, 0) / matched.length,
    lng: matched.reduce((sum, p) => sum + p.lng, 0) / matched.length
  };
}

export const DiscoveryContractAdapter = {
  getPublishedRides,
  getRidesByPlace,
  departureDates,
  getCompletedTripCategories,
  getHostPublishingAnchor,
  referencesPlace
};
