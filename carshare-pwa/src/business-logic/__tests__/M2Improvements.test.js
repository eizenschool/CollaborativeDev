import { describe, expect, it, vi } from 'vitest';
import { buildAutocompleteRequest, createMapDiagnostic } from '../GooglePlacesService.js';
import { queryWaypointRecommendations } from '../M2WaypointRecommendationService.js';
import { RideLiveTrackingService } from '../RideLiveTrackingService.js';
import { PlaceQueryService } from '../discovery/PlaceQueryService.js';
import { buildReplay, HISTORY_PAGE_SIZE } from '../../presentation/components/trip/TripRouteReplay.jsx';
import { readFile } from 'node:fs/promises';

const migration = new URL('../../../database/sql/046_m2_adaptive_checkin.sql', import.meta.url);
const trackingMigration = new URL('../../../database/sql/047_m2_live_location_tracking.sql', import.meta.url);
const correctnessMigration = new URL('../../../database/sql/054_m2_tracking_correctness_fixes.sql', import.meta.url);
const adminRemovalMigration = new URL('../../../database/sql/055_m2_remove_trust_admin.sql', import.meta.url);
const familyCryptoMigration = new URL('../../../database/sql/057_m2_fix_family_link_crypto_schema.sql', import.meta.url);
const familyShareFunction = new URL('../../../supabase/functions/m2-live-share/index.ts', import.meta.url);
const rideDetailComponent = new URL('../../presentation/components/ride/RideDetail.jsx', import.meta.url);
const safetyRoutesComponent = new URL('../../presentation/components/safety/SafetyRoutes.jsx', import.meta.url);
const publishRideComponent = new URL('../../presentation/components/ride/PublishRide.jsx', import.meta.url);
const replayComponent = new URL('../../presentation/components/trip/TripRouteReplay.jsx', import.meta.url);
const liveMapComponent = new URL('../../presentation/components/maps/LiveRideMap.jsx', import.meta.url);

describe('Module 2 improvement contracts', () => {
  it('adds a GPS bias only for a sufficiently accurate current-location preview', () => {
    expect(buildAutocompleteRequest('KL', { origin: { latitude: 3.139, longitude: 101.6869, accuracy: 100 } })).toMatchObject({
      origin: { lat: 3.139, lng: 101.6869 },
      locationBias: { radius: 5000 }
    });
    expect(buildAutocompleteRequest('KL', { origin: { latitude: 3.139, longitude: 101.6869, accuracy: 501 } })).not.toHaveProperty('locationBias');
  });

  it('keeps live-map diagnostics useful without exposing keys, URLs, or coordinates', () => {
    const diagnostic = createMapDiagnostic('map-construction', {
      name: 'MapsError',
      code: 'INVALID_MAP',
      message: 'Key AIza-secret failed at https://maps.googleapis.com/maps/api/js near 3.8002125,101.8720013'
    });

    expect(diagnostic).toMatchObject({
      stage: 'map-construction',
      code: 'INVALID_MAP',
      name: 'MapsError'
    });
    expect(diagnostic.message).not.toContain('AIza');
    expect(diagnostic.message).not.toContain('maps.googleapis.com');
    expect(diagnostic.message).not.toContain('3.8002125');
    expect(diagnostic.message).toContain('[redacted-key]');
    expect(diagnostic.message).toContain('[redacted-url]');
    expect(diagnostic.message).toContain('[redacted-number]');
  });

  it('keeps React loading content outside the Google-owned map canvas', async () => {
    const source = await readFile(liveMapComponent, 'utf8');

    expect(source).toContain('<div className="live-ride-map-canvas" ref={containerRef} />');
    expect(source).toContain('<span className="live-map-loading">Loading live map…</span>');
    expect(source).not.toContain('className="live-ride-map" ref={containerRef}');
  });

  it('filters Module 6 suggestions to culinary and heritage stops', async () => {
    const original = PlaceQueryService.queryPlacesAlongRoute;
    PlaceQueryService.queryPlacesAlongRoute = vi.fn().mockResolvedValue([
      { sourcePlaceId: 'heritage-late', name: 'Museum', category: 'heritage', routeProgress: 0.8 },
      { sourcePlaceId: 'nature-skip', name: 'Park', category: 'nature', routeProgress: 0.1 },
      { sourcePlaceId: 'culinary-first', name: 'Cafe', category: 'culinary', routeProgress: 0.2 },
      { sourcePlaceId: 'selected-stop', name: 'Selected', category: 'heritage', routeProgress: 0.3 }
    ]);
    try {
      const results = await queryWaypointRecommendations({
        recommendationRoute: { origin: { lat: 3.139, lng: 101.6869 }, destination: { lat: 3.210, lng: 101.740 } }
      }, [{ placeId: 'selected-stop' }]);
      expect(results.map((item) => item.placeId)).toEqual(['culinary-first', 'heritage-late']);
      expect(results.every((item) => ['culinary', 'heritage'].includes(item.category))).toBe(true);
      expect(results.every((item) => item.stopMinutes === 30)).toBe(true);
    } finally {
      PlaceQueryService.queryPlacesAlongRoute = original;
    }
  });

  it('keeps adaptive check-in, private live tracking, family links, and history replay', async () => {
    const [checkIn, tracking, removal] = await Promise.all([
      readFile(migration, 'utf8'),
      readFile(trackingMigration, 'utf8'),
      readFile(adminRemovalMigration, 'utf8')
    ]);
    expect(checkIn).toContain('p_accuracy_meters > 150');
    expect(checkIn).toContain('least(350::double precision, 200 + p_accuracy_meters)');
    expect(checkIn).toContain('check_in_accuracy_meters');
    expect(tracking).toContain('create table if not exists private.m2_live_locations');
    expect(tracking).toContain('create table if not exists private.m2_location_history');
    expect(tracking).toContain('realtime.broadcast_changes');
    expect(tracking).toContain('m2-live:');
    expect(tracking).toContain('grant execute on function public.get_m2_family_location_by_token(text) to service_role');
    expect(removal).toContain('drop table if exists private.project_user_roles');
    expect(removal).toContain('drop table if exists private.m2_ride_disputes');
    expect(removal).toContain('create or replace function public.get_m2_live_locations');
    expect(removal).toContain('create or replace function private.cleanup_m2_location_data');
    expect(removal).not.toContain('drop table if exists private.m2_location_history');
  });

  it('schema-qualifies Family Link crypto while retaining the authenticated RPC boundary', async () => {
    const source = await readFile(familyCryptoMigration, 'utf8');

    expect(source).toContain('set search_path = \'\'');
    expect(source).toContain('extensions.gen_random_bytes(32)');
    expect(source).toContain("extensions.digest(v_raw, 'sha256')");
    expect(source).toContain('revoke all on function public.create_m2_family_location_share(uuid)');
    expect(source).toContain('grant execute on function public.create_m2_family_location_share(uuid)');
    expect(source).toContain('to authenticated');
  });

  it('lets a passenger observe Driver points without starting self-sharing', async () => {
    const originals = {
      getLiveSnapshot: RideLiveTrackingService.getLiveSnapshot,
      subscribeLive: RideLiveTrackingService.subscribeLive
    };
    let remoteHandler;
    const snapshots = [];
    const remotePoints = [];
    const unsubscribe = vi.fn();
    RideLiveTrackingService.getLiveSnapshot = vi.fn().mockResolvedValue([{ userId: 'driver-1', role: 'Driver' }]);
    RideLiveTrackingService.subscribeLive = vi.fn((rideId, options) => {
      expect(rideId).toBe('ride-1');
      expect(options.isDriver).toBe(false);
      remoteHandler = options.onPoint;
      return unsubscribe;
    });

    try {
      const cleanup = await RideLiveTrackingService.observeLive('ride-1', {
        isDriver: false,
        onSnapshot: (points) => snapshots.push(points),
        onPoint: (point) => remotePoints.push(point),
        documentObject: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
        windowObject: { addEventListener: vi.fn(), removeEventListener: vi.fn() }
      });
      remoteHandler({ userId: 'driver-1', role: 'Driver', lat: 3.1, lng: 101.6, accuracyM: 12 });

      expect(snapshots).toEqual([[expect.objectContaining({ userId: 'driver-1', role: 'Driver' })]]);
      expect(remotePoints).toEqual([expect.objectContaining({ userId: 'driver-1', role: 'Driver' })]);
      cleanup();
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally {
      Object.assign(RideLiveTrackingService, originals);
    }
  });

  it('refreshes the filtered snapshot after a Realtime reconnect', async () => {
    const originals = {
      getLiveSnapshot: RideLiveTrackingService.getLiveSnapshot,
      subscribeLive: RideLiveTrackingService.subscribeLive
    };
    let statusHandler;
    RideLiveTrackingService.getLiveSnapshot = vi.fn()
      .mockResolvedValueOnce([{ userId: 'driver-1', role: 'Driver', capturedAt: '2026-08-24T00:00:00Z' }])
      .mockResolvedValueOnce([{ userId: 'driver-1', role: 'Driver', capturedAt: '2026-08-24T00:00:20Z' }]);
    RideLiveTrackingService.subscribeLive = vi.fn((rideId, options) => {
      statusHandler = options.onStatus;
      return vi.fn();
    });
    const snapshots = [];
    try {
      const cleanup = await RideLiveTrackingService.observeLive('ride-1', {
        onSnapshot: (points) => snapshots.push(points),
        documentObject: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
        windowObject: { addEventListener: vi.fn(), removeEventListener: vi.fn() }
      });
      statusHandler('SUBSCRIBED');
      await vi.waitFor(() => expect(snapshots).toHaveLength(2));
      expect(RideLiveTrackingService.getLiveSnapshot).toHaveBeenCalledTimes(2);
      cleanup();
    } finally {
      Object.assign(RideLiveTrackingService, originals);
    }
  });

  it('throttles local uploads and cleans up geolocation watchers', async () => {
    const originals = {
      startSharing: RideLiveTrackingService.startSharing,
      publishLocation: RideLiveTrackingService.publishLocation,
      stopSharing: RideLiveTrackingService.stopSharing
    };
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const callbacks = [];
    const clearWatch = vi.fn();
    const geolocation = {
      watchPosition: vi.fn((success) => { callbacks.push(success); return callbacks.length; }),
      clearWatch
    };
    const listeners = {};
    const documentObject = {
      visibilityState: 'visible',
      addEventListener: vi.fn((name, handler) => { listeners[name] = handler; }),
      removeEventListener: vi.fn()
    };
    const windowObject = {
      addEventListener: vi.fn((name, handler) => { listeners[name] = handler; }),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 7),
      clearInterval: vi.fn()
    };
    RideLiveTrackingService.startSharing = vi.fn().mockResolvedValue('session-1');
    RideLiveTrackingService.publishLocation = vi.fn().mockResolvedValue({ accepted: true });
    RideLiveTrackingService.stopSharing = vi.fn().mockResolvedValue(true);
    try {
      const watcher = RideLiveTrackingService.createWatcher({ rideId: 'ride-1', geolocation, documentObject, windowObject });
      await watcher.start();
      callbacks[0]({ coords: { latitude: 3.1, longitude: 101.6, accuracy: 10 }, timestamp: 100_000 });
      await vi.waitFor(() => expect(RideLiveTrackingService.publishLocation).toHaveBeenCalledTimes(1));
      now.mockReturnValue(105_000);
      callbacks[0]({ coords: { latitude: 3.2, longitude: 101.7, accuracy: 12 }, timestamp: 105_000 });
      expect(RideLiveTrackingService.publishLocation).toHaveBeenCalledTimes(1);
      now.mockReturnValue(111_000);
      callbacks[0]({ coords: { latitude: 3.3, longitude: 101.8, accuracy: 14 }, timestamp: 111_000 });
      await vi.waitFor(() => expect(RideLiveTrackingService.publishLocation).toHaveBeenCalledTimes(2));
      documentObject.visibilityState = 'hidden';
      listeners.visibilitychange();
      expect(clearWatch).toHaveBeenCalledWith(1);
      documentObject.visibilityState = 'visible';
      listeners.visibilitychange();
      expect(geolocation.watchPosition).toHaveBeenCalledTimes(2);
      await watcher.stop();
      expect(RideLiveTrackingService.stopSharing).toHaveBeenCalledWith('ride-1');
      expect(windowObject.clearInterval).toHaveBeenCalledWith(7);
    } finally {
      now.mockRestore();
      Object.assign(RideLiveTrackingService, originals);
    }
  });

  it('splits replay gaps and keeps cursor pagination visible', async () => {
    const points = [
      { userId: 'passenger-1', role: 'Passenger', lat: 3.1, lng: 101.6, capturedAt: '2026-08-24T00:00:00Z' },
      { userId: 'passenger-1', role: 'Passenger', lat: 3.2, lng: 101.7, capturedAt: '2026-08-24T00:01:00Z' },
      { userId: 'passenger-1', role: 'Passenger', lat: 3.3, lng: 101.8, capturedAt: '2026-08-24T00:04:00Z' },
      { userId: 'passenger-1', role: 'Passenger', lat: 3.4, lng: 101.9, capturedAt: '2026-08-24T00:05:00Z' }
    ];
    expect(buildReplay(points, Date.parse('2026-08-24T00:06:00Z')).segments).toHaveLength(2);
    expect(HISTORY_PAGE_SIZE).toBe(500);
    expect(await readFile(replayComponent, 'utf8')).toContain('Load more route history');
  });

  it('keeps live rollout fail-closed while removing the Trust Admin surface', async () => {
    const [migration049, removal, familyFunction, rideDetail, safetyRoutes, publishRide] = await Promise.all([
      readFile(correctnessMigration, 'utf8'),
      readFile(adminRemovalMigration, 'utf8'),
      readFile(familyShareFunction, 'utf8'),
      readFile(rideDetailComponent, 'utf8'),
      readFile(safetyRoutesComponent, 'utf8'),
      readFile(publishRideComponent, 'utf8')
    ]);
    expect(migration049).toContain('(check_in_accuracy_meters is null or check_in_accuracy_meters between 0 and 150)');
    expect(removal).toContain('drop function if exists public.admin_list_m2_open_disputes(uuid)');
    expect(removal).toContain('get_m2_family_location_snapshot');
    expect(removal).toContain("'markerId', case when l.user_role = 'Driver' then 'driver' else 'shared-passenger' end");
    expect(familyFunction).toContain('admin.rpc("get_m2_family_location_snapshot"');
    expect(familyFunction).not.toContain('user_id');
    expect(rideDetail).toContain("VITE_M2_LIVE_TRACKING_ENABLED === 'true'");
    expect(rideDetail).toContain('RideLiveTrackingService.observeLive');
    expect(rideDetail).not.toContain('ProjectAdminService');
    expect(safetyRoutes).not.toContain('AdminDisputeConsole');
    expect((publishRide.match(/currentLocationPreview=/g) || [])).toHaveLength(3);
  });
});
