import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateGuideRoute } from '../routeInfo.ts';

afterEach(() => vi.unstubAllGlobals());

function fakeAdmin(rpcImpl) {
  return { rpc: rpcImpl || (async () => ({ data: 1, error: null })) };
}

const KL = { lat: 3.139, lng: 101.6869 };
const destination = { lat: 3.2379, lng: 101.6839, name: 'Batu Caves', state: 'Selangor' };

function stubGoogleRoutesSuccess(distanceMeters = 13000, durationSeconds = 1800) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    routes: [{
      distanceMeters, duration: `${durationSeconds}s`,
      legs: [{ startLocation: { latLng: { latitude: KL.lat, longitude: KL.lng } },
        endLocation: { latLng: { latitude: destination.lat, longitude: destination.lng } } }]
    }]
  }), { status: 200 })));
}

describe('Tumpang Guide real driving-route estimate (get_route_estimate)', () => {
  it('returns nothing but a real number when there is no origin at all', async () => {
    const admin = fakeAdmin();
    const result = await estimateGuideRoute({
      admin, origin: null, originPlaceId: null, originLabel: '', destination,
      googleKey: 'key', routesEnabled: true
    });
    expect(result).toMatchObject({ kind: 'unavailable', degradedReason: 'no_origin', straightLineKm: null });
  });

  it('degrades to straight-line when the Routes kill switch is off, without touching the quota RPC or Google', async () => {
    const rpc = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await estimateGuideRoute({
      admin: fakeAdmin(rpc), origin: KL, originPlaceId: null, originLabel: 'Kuala Lumpur', destination,
      googleKey: 'key', routesEnabled: false
    });
    expect(result).toMatchObject({ kind: 'straight_line', degradedReason: 'routes_unconfigured' });
    expect(result.straightLineKm).toBeGreaterThan(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('degrades to straight-line when GOOGLE_ROUTES_SERVER_KEY is empty, without touching the quota RPC or Google', async () => {
    const rpc = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await estimateGuideRoute({
      admin: fakeAdmin(rpc), origin: KL, originPlaceId: null, originLabel: 'Kuala Lumpur', destination,
      googleKey: '', routesEnabled: true
    });
    expect(result).toMatchObject({ kind: 'straight_line', degradedReason: 'routes_unconfigured' });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the quota RPC before ever calling Google Routes, and returns a real duration on success', async () => {
    const calls = [];
    const rpc = vi.fn(async (name, args) => { calls.push({ type: 'rpc', name, args }); return { data: 1, error: null }; });
    vi.stubGlobal('fetch', vi.fn(async (...fetchArgs) => { calls.push({ type: 'fetch', url: String(fetchArgs[0]) }); return new Response(JSON.stringify({
      routes: [{ distanceMeters: 13000, duration: '1800s',
        legs: [{ startLocation: { latLng: { latitude: KL.lat, longitude: KL.lng } },
          endLocation: { latLng: { latitude: destination.lat, longitude: destination.lng } } }] }]
    }), { status: 200 }); }));
    const result = await estimateGuideRoute({
      admin: fakeAdmin(rpc), origin: KL, originPlaceId: null, originLabel: 'Kuala Lumpur', destination,
      googleKey: 'key', routesEnabled: true
    });
    expect(calls[0]).toMatchObject({ type: 'rpc', name: 'consume_m6_guide_route_quota' });
    expect(calls[1]).toMatchObject({ type: 'fetch' });
    expect(result).toMatchObject({ kind: 'google_routes', distanceMeters: 13000, durationSeconds: 1800, degradedReason: null });
    expect(result.straightLineKm).toBeGreaterThan(0);
  });

  it('degrades to straight-line and never calls Google when the Guide daily budget is exhausted', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'M6_GUIDE_ROUTE_BUDGET: the Guide daily route allowance is used up' } }));
    const result = await estimateGuideRoute({
      admin: fakeAdmin(rpc), origin: KL, originPlaceId: null, originLabel: 'Kuala Lumpur', destination,
      googleKey: 'key', routesEnabled: true
    });
    expect(result).toMatchObject({ kind: 'straight_line', degradedReason: 'guide_budget_exhausted' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('degrades to straight-line when the shared global Google quota is exhausted', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'Daily Routes API limit reached. Try again after midnight Malaysia time' } }));
    vi.stubGlobal('fetch', vi.fn());
    const result = await estimateGuideRoute({
      admin: fakeAdmin(rpc), origin: KL, originPlaceId: null, originLabel: 'Kuala Lumpur', destination,
      googleKey: 'key', routesEnabled: true
    });
    expect(result).toMatchObject({ kind: 'straight_line', degradedReason: 'global_quota_exhausted' });
  });

  it('degrades to straight-line without throwing when Google returns a 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED: quota' } }), { status: 429 })));
    const result = await estimateGuideRoute({
      admin: fakeAdmin(), origin: KL, originPlaceId: null, originLabel: 'Kuala Lumpur', destination,
      googleKey: 'key', routesEnabled: true
    });
    expect(result).toMatchObject({ kind: 'straight_line', degradedReason: 'routes_failed' });
  });

  it('degrades to straight-line with a distinct reason when Google finds no drivable route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ routes: [] }), { status: 200 })));
    const result = await estimateGuideRoute({
      admin: fakeAdmin(), origin: KL, originPlaceId: null, originLabel: 'Kuala Lumpur', destination,
      googleKey: 'key', routesEnabled: true
    });
    expect(result).toMatchObject({ kind: 'straight_line', degradedReason: 'no_route' });
  });

  it('routes from a Google place ID when no coordinates are available, and cannot compute a straight-line fallback', async () => {
    stubGoogleRoutesSuccess();
    const admin = fakeAdmin();
    let sentBody = null;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { sentBody = JSON.parse(init.body); return new Response(JSON.stringify({
      routes: [{ distanceMeters: 13000, duration: '1800s',
        legs: [{ startLocation: { latLng: { latitude: KL.lat, longitude: KL.lng } },
          endLocation: { latLng: { latitude: destination.lat, longitude: destination.lng } } }] }]
    }), { status: 200 }); }));
    const result = await estimateGuideRoute({
      admin, origin: null, originPlaceId: 'ChIJPlaceId123', originLabel: 'Somewhere', destination,
      googleKey: 'key', routesEnabled: true
    });
    expect(sentBody.origin).toEqual({ placeId: 'ChIJPlaceId123' });
    expect(result.kind).toBe('google_routes');
  });
});
