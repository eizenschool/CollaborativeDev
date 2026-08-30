import { describe, expect, it, vi } from 'vitest';
import { fetchControlledWeather, haversineKm, retrieveControlledCandidates, seasonSignal } from '../retrieval.ts';

const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const place = (id, overrides = {}) => ({
  id: uuid(id), source_place_id: `source-${id}`, name: `Place ${id}`, category: 'nature',
  rating: 4.5, review_count: 20, state: 'Selangor', lifecycle_state: 'Active', lat: 3.15 + id / 100, lng: 101.7,
  ...overrides
});
const plan = {
  startDate: '2026-09-01', endDate: '2026-09-07', partySize: 2,
  preferredCategories: ['nature'], indoorPreference: 'either', budget: null,
  accessibilityRequired: false, children: false
};

describe('Tumpang Guide controlled retrieval', () => {
  it('computes distance without exposing coordinates to Gemini', () => {
    expect(haversineKm({ lat: 3.139, lng: 101.6869 }, { lat: 3.139, lng: 101.6869 })).toBe(0);
    expect(haversineKm(null, { lat: 3.139, lng: 101.6869 })).toBeNull();
  });

  it('applies the existing seasonal calendar values at a declared boundary', () => {
    const culinary = place(1, { category: 'culinary' });
    expect(seasonSignal(culinary, ['2026-05-31'])).toBe(.7);
    expect(seasonSignal(culinary, ['2026-06-01'])).toBe(1);
    expect(seasonSignal(culinary, ['2026-08-31'])).toBe(1);
    expect(seasonSignal(culinary, ['2026-09-01'])).toBe(.7);
  });

  it('uses batched weather evidence and withholds outdoor places only when every selected day is severe', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ daily: { weather_code: [96, 99] } }) });
    const places = [place(1)];
    const weather = await fetchControlledWeather(places, '2026-09-01', '2026-09-02', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(weather.get(places[0].id)).toMatchObject({ checked: true, severeEveryDay: true });
    expect(retrieveControlledCandidates(places, [], [], [], { ...plan, endDate: '2026-09-02' }, { weatherByPlace: weather })).toEqual([]);
  });

  it('hard-filters unverified accessibility and Ride capacity, while never returning retired places', () => {
    const places = [place(1), place(2, { lifecycle_state: 'Retired' }), place(3)];
    const attributes = [
      { place_id: places[0].id, wheelchair_accessible: true },
      { place_id: places[2].id, wheelchair_accessible: false }
    ];
    const rides = [{ destination_place_id: 'source-1', departure_at: '2026-09-03T01:00:00Z', seats_total: 4, seats_available: 2, status: 'Published' }];
    const result = retrieveControlledCandidates(places, rides, attributes, [], { ...plan, accessibilityRequired: true }, { origin: { lat: 3.139, lng: 101.6869 } });
    expect(result.map((item) => item.id)).toEqual([places[0].id]);
    expect(result[0]).toMatchObject({ hasRide: true, availableSeats: 2 });
    expect(result[0].reasonCodes).toContain('seat_headroom');
  });
});

