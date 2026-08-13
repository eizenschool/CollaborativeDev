// ===== BUSINESS LOGIC LAYER (DestinationDiscoveryService) =====
// UC6.1 browse recommendations / UC6.3 record interest and continue to a ride /
// UC6.4 travel preferences / UC6.6 notification registration.
//
// The orchestration layer: it gathers the facts each signal needs, then hands
// them to the pure engines. No scoring arithmetic lives here - that is all in
// DestinationScoringEngine, so the rules stay testable without a data layer and
// this file stays readable as a sequence of steps.
//
// Order is load-bearing. Weather runs *before* scoring (UC6.11's note: a severe
// warning is not something a strong affinity should outweigh), and seat headroom
// is computed per request rather than cached, because a seat taken two minutes
// ago would otherwise still be advertised as free.

import { discoveryDb } from '../../data-access/discoveryStore.js';
import { rankCandidates } from './DestinationScoringEngine.js';
import { selectRecommendable } from './PlaceLifecycle.js';
import { buildNameRecurrenceIndex, localEconomySignal } from './ChainDetection.js';
import { resolveAffinity } from './AffinityResolver.js';
import { distanceKm, maxDistanceKm } from './geo.js';
import { applyWeatherGate, fetchForecasts } from './WeatherGate.js';
import { SEASON_VALUES } from './constants.js';
import { DiscoveryContractAdapter } from './DiscoveryContractAdapter.js';

/**
 * Seasonal fit (FR-6.24). A registered VM2026 event is aligned by definition;
 * everything else sits at the undeclared value.
 *
 * Declared seasonal windows per category are a catalogue concern that ingestion
 * will supply. Until it does, scoring an unknown season as "undeclared" (0.7)
 * rather than guessing keeps the signal honest - it neither rewards nor punishes
 * a place for data the system does not yet hold.
 */
function seasonSignal(place) {
  return place.isVm2026Event ? SEASON_VALUES.ALIGNED : SEASON_VALUES.UNDECLARED;
}

/** The highest review count among same-category, same-state peers (headroom denominator). */
function peerMaxReviewCount(place, places) {
  return places
    .filter((p) => p.category === place.category && p.state === place.state)
    .reduce((max, p) => Math.max(max, Number(p.reviewCount) || 0), 0);
}

export const DestinationDiscoveryService = {
  /**
   * UC6.1 - assembles, gates, scores and sections the candidate set.
   *
   * `origin` is the user's location; where it is missing every candidate scores
   * full journey cost rather than being dropped, so the view still works before
   * location permission is granted (UC6.1 A1 asks for a location, it does not
   * make one mandatory).
   */
  async getRecommendations({ userId, origin, travelDate } = {}) {
    const [allPlaces, rides, demand, preferences] = await Promise.all([
      discoveryDb.listPlaces(),
      DiscoveryContractAdapter.getPublishedRides(),
      discoveryDb.latentDemand(travelDate),
      userId ? discoveryDb.getPreferences(userId) : null
    ]);

    // FR-6.4: Retired and unenriched places are withheld before anything else,
    // so no later step can accidentally surface one.
    const recommendable = selectRecommendable(allPlaces);

    // UC6.11 runs before scoring, not within it.
    const forecasts = await fetchForecasts(recommendable, travelDate);
    const { candidates: afterWeather, withheld: weatherWithheld } =
      applyWeatherGate(recommendable, forecasts);

    const completedTrips = await DiscoveryContractAdapter.getCompletedTripCategories(userId, allPlaces);
    const ridesByPlace = DiscoveryContractAdapter.getRidesByPlace(afterWeather, rides, travelDate);

    // Chain detection is indexed once across the whole catalogue rather than the
    // gated subset: an outlet withheld for weather still counts as evidence that
    // its siblings belong to a chain.
    const chainIndex = buildNameRecurrenceIndex(allPlaces);

    const distanceByPlace = new Map(afterWeather.map((place) =>
      [place.id, distanceKm(origin, { lat: place.lat, lng: place.lng })]
    ));
    const furthest = maxDistanceKm([...distanceByPlace.values()]);

    const scored = rankCandidates(afterWeather.map((place) => ({
      placeId: place.id,
      affinity: resolveAffinity(place.category, {
        completedTrips,
        preferredCategories: preferences?.preferredCategories
      }).value,
      season: seasonSignal(place),
      local: localEconomySignal(place, chainIndex),
      rating: place.rating,
      reviewCount: place.reviewCount,
      peerMaxReviewCount: peerMaxReviewCount(place, allPlaces),
      rides: ridesByPlace.get(place.id) || [],
      distanceKm: distanceByPlace.get(place.id),
      maxCandidateDistanceKm: furthest,
      interestedUserCount: demand.get(place.id) || 0
    })));

    // Re-attach the place records the UI needs to render. The engine works on
    // ids and numbers alone so it never has to know about photos or descriptions.
    const byId = new Map(afterWeather.map((p) => [p.id, p]));
    const decorate = (entry) => ({
      ...entry,
      place: byId.get(entry.placeId),
      rides: ridesByPlace.get(entry.placeId) || [],
      interestedUsers: demand.get(entry.placeId) || 0,
      distanceKm: distanceByPlace.get(entry.placeId)
    });

    return {
      primary: scored.primary.map(decorate),
      unserved: scored.unserved.map(decorate),
      withheld: scored.withheld.map(decorate),
      weatherWithheld,
      preferences,
      // Lets the UI open on a date that actually has departures instead of a day
      // with none, which would show an empty served list for no good reason.
      departureDates: DiscoveryContractAdapter.departureDates(rides)
    };
  },

  /** UC6.2 - one destination, with the same rides/demand context the list used. */
  async getDestination(placeId, { travelDate } = {}) {
    const [place, rides, demand] = await Promise.all([
      discoveryDb.getPlace(placeId),
      DiscoveryContractAdapter.getPublishedRides(),
      discoveryDb.latentDemand(travelDate)
    ]);
    if (!place) return null;

    const serving = DiscoveryContractAdapter.getRidesByPlace([place], rides, travelDate);
    return {
      place,
      rides: serving.get(place.id) || [],
      interestedUsers: demand.get(place.id) || 0
    };
  },

  /**
   * FR-6.30 - interest, the weak signal. Recorded on selection, before the user
   * commits to anything, because a selection expresses that the destination was
   * considered regardless of whether a ride was ultimately found.
   */
  async recordInterest(userId, placeId, travelDate) {
    if (!userId || !placeId || !travelDate) return { recorded: false };
    return discoveryDb.recordInterest(userId, placeId, travelDate);
  },

  /** FR-6.33 - intent, the strong signal. */
  async registerForNotification(userId, placeId, travelDate) {
    return discoveryDb.registerForNotification(userId, placeId, travelDate);
  },

  async listRegistrations(userId) {
    return discoveryDb.listRegistrations(userId);
  },

  async cancelRegistration(userId, registrationId) {
    return discoveryDb.cancelRegistration(userId, registrationId);
  },

  /** FR-6.21 / UC6.4 - stated preferences, superseded by history as it accumulates. */
  async getPreferences(userId) {
    return userId ? discoveryDb.getPreferences(userId) : null;
  },

  async savePreferences(userId, preferences) {
    return discoveryDb.savePreferences(userId, preferences);
  },

  /**
   * UC6.4 A1 - the prompt is shown only to a user with neither history nor
   * stated preferences, and never again once dismissed.
   */
  async shouldPromptForPreferences(userId) {
    if (!userId) return false;
    const stored = await discoveryDb.getPreferences(userId);
    if (stored?.promptDismissed || stored?.preferredCategories?.length) return false;

    const places = await discoveryDb.listPlaces();
    const trips = await DiscoveryContractAdapter.getCompletedTripCategories(userId, places);
    return trips.length === 0;
  },

  /**
   * UC6.3 / FR-6.35 - the payload Module 2's publish form and Module 4's search
   * form are pre-filled from, so the user does not retype what they just chose.
   */
  buildPrefillPayload(place, origin) {
    return {
      destination: place?.name || '',
      pickup: origin?.label || '',
      destinationPlaceId: place?.sourcePlaceId || null
    };
  }
};
