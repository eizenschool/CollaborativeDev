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
import { resolveSeason } from './SeasonalCalendar.js';
import { DiscoveryContractAdapter } from './DiscoveryContractAdapter.js';

// FR-6.24 now resolves against the declared calendar in SeasonalCalendar.js
// rather than treating everything without an event as undeclared.

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

    // Resolved once per place and kept, because the detail screen has to explain
    // the seasonal score in words and recomputing it there could drift.
    const seasonByPlace = new Map(afterWeather.map((place) =>
      [place.id, resolveSeason(place, travelDate)]
    ));

    const scored = rankCandidates(afterWeather.map((place) => ({
      placeId: place.id,
      affinity: resolveAffinity(place.category, {
        completedTrips,
        preferredCategories: preferences?.preferredCategories
      }).value,
      season: seasonByPlace.get(place.id).value,
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
      distanceKm: distanceByPlace.get(entry.placeId),
      season: seasonByPlace.get(entry.placeId)
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

  /**
   * UC6.2 - one destination, carrying the same scores the list showed.
   *
   * Deliberately runs the full ranking rather than scoring this place on its own.
   * Two of the signals are relative to the candidate set - visitation headroom is
   * measured against same-category peers, journey cost against the furthest
   * candidate - so a place scored in isolation would produce different numbers
   * from the card the user just tapped. Reusing the ranking guarantees the detail
   * screen and the list can never disagree.
   */
  async getDestination(placeId, { userId, origin, travelDate } = {}) {
    const place = await discoveryDb.getPlace(placeId);
    if (!place) return null;

    const ranked = await this.getRecommendations({ userId, origin, travelDate });
    const candidate = [...ranked.primary, ...ranked.unserved, ...ranked.withheld]
      .find((entry) => entry.placeId === placeId);

    // A place withheld by the weather gate never reaches scoring, so the detail
    // screen still opens - it simply has no score to explain.
    const weatherWithheld = ranked.weatherWithheld.find((entry) => entry.id === placeId);

    return {
      place,
      candidate: candidate || null,
      rides: candidate?.rides || [],
      interestedUsers: candidate?.interestedUsers || 0,
      distanceKm: candidate?.distanceKm ?? null,
      weatherWithheld: Boolean(weatherWithheld),
      weatherReason: weatherWithheld?.weatherReason || null
    };
  },

  /**
   * UC6.7 / FR-6.34 - the demand side of the platform made visible to the supply
   * side: where people want to go that nobody is driving to.
   *
   * A destination already served by a ride with a seat left is suppressed
   * deliberately. Sending a second Host to a route that still has capacity would
   * create exactly the duplicate journey this module exists to prevent.
   *
   * Ranked by demand first, then by how close the destination sits to where this
   * Host has published before - a Host is far likelier to drive a route they
   * already know than an equally popular one across the country.
   */
  async getUnmetDemand({ userId, travelDate, origin } = {}) {
    const [places, rides, demand] = await Promise.all([
      discoveryDb.listPlaces(),
      DiscoveryContractAdapter.getPublishedRides(),
      discoveryDb.latentDemand(travelDate)
    ]);

    const recommendable = selectRecommendable(places);
    const ridesByPlace = DiscoveryContractAdapter.getRidesByPlace(recommendable, rides, travelDate);

    const hostAnchor = await DiscoveryContractAdapter.getHostPublishingAnchor(userId, places)
      || origin
      || null;

    return recommendable
      .map((place) => {
        const serving = ridesByPlace.get(place.id) || [];
        const seatsLeft = serving.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);
        return { place, serving, seatsLeft, interestedUsers: demand.get(place.id) || 0 };
      })
      // UC6.7 step 3: exclude destinations already served by a ride with a seat.
      .filter((entry) => entry.interestedUsers > 0 && entry.seatsLeft === 0)
      .map((entry) => ({
        placeId: entry.place.id,
        place: entry.place,
        interestedUsers: entry.interestedUsers,
        travelDate,
        distanceKm: hostAnchor
          ? distanceKm(hostAnchor, { lat: entry.place.lat, lng: entry.place.lng })
          : null
      }))
      .sort((a, b) =>
        b.interestedUsers - a.interestedUsers
        || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
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
