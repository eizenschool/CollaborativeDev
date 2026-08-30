// Server-side controlled retrieval. The arithmetic mirrors Module 6's existing
// DestinationScoringEngine so Gemini never becomes the ranking authority.

type Row = Record<string, unknown>;
type WeatherEvidence = { checked: boolean; severeEveryDay: boolean; advisory: boolean };

const OUTDOOR = new Set(["nature", "event"]);
const SEVERE = new Set([57, 67, 82, 96, 99]);
const ADVISORY = new Set([45, 48, 63, 65, 73, 75, 80, 81, 95]);
const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const round2 = (value: number) => Math.round(value * 100) / 100;
const normaliseName = (value: unknown) => String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function haversineKm(a: { lat?: number; lng?: number } | null, b: { lat?: number; lng?: number } | null) {
  if (!a || !b || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng))
      || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lng))
      || Math.abs(Number(a.lat)) > 90 || Math.abs(Number(b.lat)) > 90
      || Math.abs(Number(a.lng)) > 180 || Math.abs(Number(b.lng)) > 180) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(Number(b.lat) - Number(a.lat));
  const dLng = radians(Number(b.lng) - Number(a.lng));
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(Number(a.lat))) * Math.cos(radians(Number(b.lat))) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function qualitySignal(place: Row) {
  const rating = Number(place.rating);
  const reviews = Number(place.review_count);
  if (!Number.isFinite(rating)) return 0;
  return clamp((rating - 1) / 4) * clamp(Number.isFinite(reviews) ? reviews / 10 : 0);
}

function annualWindow(date: string, from: [number, number], to: [number, number]) {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const value = Number(match[1]) * 100 + Number(match[2]);
  const start = from[0] * 100 + from[1];
  const end = to[0] * 100 + to[1];
  return start <= end ? value >= start && value <= end : value >= start || value <= end;
}

export function seasonSignal(place: Row, dates: string[]) {
  const state = String(place.state || "");
  const category = String(place.category || "");
  const values = dates.map((date) => {
    if (["Kelantan", "Terengganu", "Pahang"].includes(state)
        && ["nature", "event"].includes(category)
        && annualWindow(date, [11, 1], [2, 29])) return 0.3;
    if (category === "culinary" && annualWindow(date, [6, 1], [8, 31])) return 1;
    return 0.7;
  });
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.7;
}

function isoDates(start: unknown, end: unknown) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || ""))) return [];
  const first = new Date(`${String(start)}T00:00:00Z`);
  const last = /^\d{4}-\d{2}-\d{2}$/.test(String(end || "")) ? new Date(`${String(end)}T00:00:00Z`) : first;
  const dates: string[] = [];
  for (let cursor = first; cursor <= last && dates.length < 7; cursor = new Date(cursor.getTime() + 86400000)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export async function fetchControlledWeather(
  places: Row[], startDate: string, endDate: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}
) {
  const outdoor = places.filter((place) => OUTDOOR.has(String(place.category))
    && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)));
  const evidence = new Map<string, WeatherEvidence>();
  if (!outdoor.length || !startDate || typeof fetchImpl !== "function") return evidence;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const query = new URLSearchParams({
      latitude: outdoor.map((place) => String(place.lat)).join(","),
      longitude: outdoor.map((place) => String(place.lng)).join(","),
      daily: "weather_code", start_date: startDate, end_date: endDate || startDate,
      timezone: "Asia/Kuala_Lumpur"
    });
    const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: controller.signal });
    if (!response.ok) return evidence;
    const body = await response.json();
    const entries = Array.isArray(body) ? body : [body];
    outdoor.forEach((place, index) => {
      const codes = Array.isArray(entries[index]?.daily?.weather_code)
        ? entries[index].daily.weather_code.map(Number).filter(Number.isFinite) : [];
      if (!codes.length) return;
      evidence.set(String(place.id), {
        checked: true,
        severeEveryDay: codes.every((code: number) => SEVERE.has(code)),
        advisory: codes.some((code: number) => SEVERE.has(code) || ADVISORY.has(code))
      });
    });
  } catch { /* Weather absence is unknown, never falsely clear or severe. */ }
  finally { clearTimeout(timeout); }
  return evidence;
}

function hardAttributeMatch(attr: Row, plan: Row) {
  if (plan.accessibilityRequired && attr.wheelchair_accessible !== true) return false;
  if (plan.children && attr.suitable_for_children !== true) return false;
  if (["indoor", "outdoor"].includes(String(plan.indoorPreference))
      && attr.indoor_outdoor !== "unknown"
      && attr.indoor_outdoor !== plan.indoorPreference
      && attr.indoor_outdoor !== "mixed") return false;
  const price = attr.price_level === null || attr.price_level === undefined ? null : Number(attr.price_level);
  if (plan.budget === "free" && price !== 0) return false;
  if (plan.budget === "low" && (price === null || price > 2)) return false;
  return true;
}

export function retrieveControlledCandidates(
  places: Row[], rides: Row[], attributes: Row[], interests: Row[], plan: Row,
  { weatherByPlace = new Map<string, WeatherEvidence>(), historyCategories = [], origin = null }:
  { weatherByPlace?: Map<string, WeatherEvidence>; historyCategories?: string[]; origin?: { lat?: number; lng?: number } | null } = {}
) {
  const dates = isoDates(plan.startDate, plan.endDate);
  const start = dates[0] || "";
  const end = dates.at(-1) || start;
  const attributeByPlace = new Map(attributes.map((row) => [String(row.place_id), row]));
  const demandByPlace = new Map<string, Set<string>>();
  for (const row of interests) {
    const placeId = String(row.place_id || "");
    if (!demandByPlace.has(placeId)) demandByPlace.set(placeId, new Set());
    demandByPlace.get(placeId)?.add(String(row.user_id || row.id || "anonymous"));
  }
  const preferred = new Set(Array.isArray(plan.preferredCategories) ? plan.preferredCategories.map(String) : []);
  const partySize = Math.max(1, Math.min(20, Number(plan.partySize) || 1));
  const completed = historyCategories.filter((category) => ["culinary", "heritage", "nature", "event"].includes(category));
  const recommendable = places.filter((place) => ["Active", "Provisional", "Stale"].includes(String(place.lifecycle_state)));
  const peerMax = new Map<string, number>();
  const nameCounts = new Map<string, Set<string>>();
  for (const place of recommendable) {
    const peerKey = `${place.state}::${place.category}`;
    peerMax.set(peerKey, Math.max(peerMax.get(peerKey) || 0, Number(place.review_count) || 0));
    const nameKey = `${normaliseName(place.state)}::${normaliseName(place.name)}`;
    if (!nameCounts.has(nameKey)) nameCounts.set(nameKey, new Set());
    nameCounts.get(nameKey)?.add(String(place.id));
  }
  const distances = recommendable.map((place) => haversineKm(origin, { lat: Number(place.lat), lng: Number(place.lng) }));
  const maxDistance = Math.max(0, ...distances.filter((distance): distance is number => Number.isFinite(distance) && Number(distance) > 0));

  return recommendable.map((place) => {
    const attr = attributeByPlace.get(String(place.id)) || {};
    if (!hardAttributeMatch(attr, plan)) return null;
    const weather = weatherByPlace.get(String(place.id));
    if (OUTDOOR.has(String(place.category)) && weather?.severeEveryDay) return null;
    const serving = rides.filter((ride) => ride.destination_place_id === place.source_place_id
      && ["Published", "Matched"].includes(String(ride.status))
      && String(ride.departure_at).slice(0, 10) >= start
      && String(ride.departure_at).slice(0, 10) <= end
      && Number(ride.seats_available) >= partySize);
    const distance = haversineKm(origin, { lat: Number(place.lat), lng: Number(place.lng) });
    const category = String(place.category);
    const affinity = completed.length
      ? completed.filter((item) => item === category).length / completed.length
      : (preferred.size ? (preferred.has(category) ? 1 : 0.4) : 0.5);
    const season = seasonSignal(place, dates);
    const quality = qualitySignal(place);
    const peak = peerMax.get(`${place.state}::${place.category}`) || 0;
    const headroom = peak <= 0 ? 1 : clamp(1 - (Number(place.review_count) || 0) / peak);
    const local = (nameCounts.get(`${normaliseName(place.state)}::${normaliseName(place.name)}`)?.size || 0) >= 3 ? 0 : 1;
    const seatHeadroom = serving.reduce((best, ride) => {
      const total = Number(ride.seats_total);
      return total > 0 ? Math.max(best, clamp(Number(ride.seats_available) / total)) : best;
    }, 0);
    const journeyCost = !Number.isFinite(distance) || maxDistance <= 0 ? 1 : clamp(1 - Number(distance) / maxDistance);
    const demandConvergence = clamp((demandByPlace.get(String(place.id))?.size || 0) / 4);
    const desirability = round2(affinity * .30 + season * .25 + quality * .20 + headroom * .15 + local * .10);
    const accessibility = round2(seatHeadroom * .55 + journeyCost * .30 + demandConvergence * .15);
    const reasonCodes = [
      affinity >= .5 ? "affinity" : null, season >= 1 ? "season" : null,
      quality >= .55 ? "quality" : null, headroom >= .5 ? "headroom" : null,
      local >= 1 ? "local" : null, seatHeadroom > 0 ? "seat_headroom" : null,
      journeyCost >= .6 ? "journey_cost" : null, demandConvergence > 0 ? "demand_convergence" : null,
      weather?.checked ? "weather_checked" : null, dates.length > 1 ? "date_range_consistency" : null
    ].filter(Boolean) as string[];
    if (!reasonCodes.length) reasonCodes.push("local");
    return {
      ...place, attributes: attr, hasRide: serving.length > 0,
      availableSeats: Math.max(0, ...serving.map((ride) => Number(ride.seats_available) || 0)),
      reasonCodes: reasonCodes.slice(0, 4), retrievalScore: round2(desirability * .6 + accessibility * .4),
      desirability, accessibility, distanceKm: distance, weatherAdvisory: Boolean(weather?.advisory),
      // Keep the server-side selector on the same named signal contract as
      // DestinationScoringEngine, especially for the quieter-place mode.
      signals: {
        desirability: { affinity, season, quality, headroom, local },
        accessibility: { seatHeadroom, journeyCost, demandConvergence }
      }
    };
  }).filter(Boolean).sort((a, b) => Number(b?.retrievalScore) - Number(a?.retrievalScore)).slice(0, 12) as Row[];
}

function recommendationTradeoff(candidate: Row, best: Row) {
  if (!candidate.hasRide) return "no_ride_yet";
  if ((Number(candidate.review_count) || 0) < 10) return "thin_reviews";
  if (Number.isFinite(Number(candidate.distanceKm)) && Number.isFinite(Number(best.distanceKm))
      && Number(candidate.distanceKm) > Number(best.distanceKm) + 40) return "farther_away";
  if (Number(candidate.retrievalScore) + .12 < Number(best.retrievalScore)) return "lower_personal_match";
  return "none";
}

/** Rules own the batch. Gemini receives this exact list only to explain it. */
export function selectRuleRecommendations(
  candidates: Row[],
  { shownPlaceIds = [], recommendationMode = "default" }:
  { shownPlaceIds?: unknown[]; recommendationMode?: string } = {}
) {
  const unique = [...new Map(candidates.map((item) => [String(item.id), item])).values()];
  const shown = new Set((shownPlaceIds || []).map(String));
  const sorted = [...unique].sort((a, b) => {
    if (recommendationMode === "quieter") {
      const aHeadroom = Number(a.signals?.desirability?.headroom) || 0;
      const bHeadroom = Number(b.signals?.desirability?.headroom) || 0;
      return bHeadroom - aHeadroom || Number(b.retrievalScore) - Number(a.retrievalScore);
    }
    return Number(b.retrievalScore) - Number(a.retrievalScore);
  });
  const unseen = sorted.filter((candidate) => !shown.has(String(candidate.id)));
  // A direct request for different places must never silently repeat a card.
  // Returning the remaining unseen candidates lets the response honestly say
  // that the catalogue has been exhausted when there are no more options.
  const pool = recommendationMode === "different"
    ? unseen
    : unseen.length >= 3 ? unseen : [...unseen, ...sorted.filter((candidate) => shown.has(String(candidate.id)))];
  if (!pool.length) return [];
  const used = new Set<string>();
  const best = pool[0];
  const choose = (predicate: (candidate: Row) => boolean) => {
    const found = pool.find((candidate) => !used.has(String(candidate.id)) && predicate(candidate));
    if (found) used.add(String(found.id));
    return found;
  };
  const bestChoice = choose(() => true);
  const practical = choose((candidate) => Boolean(candidate.hasRide)) || choose(() => true);
  const wildcard = choose((candidate) => candidate.category !== best.category) || choose(() => true);
  return [
    ["best_match", bestChoice], ["practical_alternative", practical], ["wildcard", wildcard]
  ].filter(([, candidate]) => candidate).map(([role, candidate]) => ({
    placeId: String((candidate as Row).id), role,
    verifiedReasonCodes: Array.isArray((candidate as Row).reasonCodes) && (candidate as Row).reasonCodes.length
      ? (candidate as Row).reasonCodes.slice(0, 4) : ["local"],
    tradeoffCode: recommendationTradeoff(candidate as Row, best),
    previouslyShown: shown.has(String((candidate as Row).id))
  }));
}
