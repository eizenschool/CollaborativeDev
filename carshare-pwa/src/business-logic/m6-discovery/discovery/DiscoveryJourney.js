import { CATEGORY } from './constants.js';
import { todayIso } from './localDate.js';

export const DEFAULT_ORIGIN = { lat: 3.139, lng: 101.6869, label: 'Kuala Lumpur', isDefault: true };
const KEY = 'm6-exploration';
function read(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } }
function write(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional tab persistence. */ } }
export function validTravelDate(value, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00`);
  // A date can be valid for the journey even when it currently has no ride.
  // The caller decides what to show for that date; silently replacing it with
  // a date that happens to have a ride would break the traveller's choice.
  return Number.isFinite(date.getTime())
    && todayIso(date) === value
    && value >= todayIso(now);
}
export function discoveryFilters(params) {
  return {
    date: validTravelDate(params.get('date')) ? params.get('date') : todayIso(),
    category: Object.values(CATEGORY).includes(params.get('category')) ? params.get('category') : 'all',
    query: params.get('q') || ''
  };
}
export function readOrigin() { return normalizeOrigin(read(`${KEY}:origin`)) || { ...DEFAULT_ORIGIN }; }
export function normalizeOrigin(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  if (!value?.label || !Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { label: value.label, lat, lng, ...(value.placeId ? { placeId: value.placeId } : {}), isDefault: value.isDefault === true };
}
export function saveOrigin(value) { const origin = normalizeOrigin(value); if (origin) write(`${KEY}:origin`, origin); return origin; }
export function saveExploreReturn(url, scrollY = 0) {
  if (/^\/home(?:\?|$)/.test(url)) write(`${KEY}:return`, { url, scrollY });
}
export function readExploreReturn() { const value = read(`${KEY}:return`); return /^\/home(?:\?|$)/.test(value?.url || '') ? value : { url: '/home', scrollY: 0 }; }
export function matchingCandidates(list, category, query) {
  const text = query.trim().toLowerCase();
  return (list || []).filter(({ place }) => (category === 'all' || place?.category === category)
    && (!text || [place?.name, place?.state, place?.category].some((value) => value?.toLowerCase().includes(text))));
}
export function trafficText(rides = [], status = 'available') {
  if (status !== 'available') return 'Ride information unavailable';
  if (!rides.length) return 'No listed ride for this date';
  const seats = Math.max(0, ...rides.map((ride) => Number(ride.seatsAvailable) || 0));
  return `${rides.length} listed ride${rides.length === 1 ? '' : 's'} · ${seats > 0 ? `up to ${seats} seat${seats === 1 ? '' : 's'} in one ride` : 'no seats remaining'}`;
}
