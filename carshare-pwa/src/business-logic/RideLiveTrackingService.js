// Module 2 live location boundary. Presentation never imports Supabase or
// handles Realtime payloads directly.
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';

export const LIVE_UPLOAD_INTERVAL_MS = 10_000;
export const LIVE_STALE_AFTER_MS = 30_000;
export const LIVE_UNAVAILABLE_AFTER_MS = 120_000;

function normalizePoint(row) {
  if (!row) return null;
  const latitude = Number(row.latitude ?? row.lat);
  const longitude = Number(row.longitude ?? row.lng);
  const accuracyM = Number(row.accuracy_meters ?? row.accuracyM ?? row.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracyM)) return null;
  return {
    userId: row.user_id ?? row.userId,
    role: row.user_role ?? row.role,
    lat: latitude,
    lng: longitude,
    accuracyM,
    headingDeg: row.heading_degrees ?? row.headingDeg ?? null,
    speedMps: row.speed_mps ?? row.speedMps ?? null,
    capturedAt: row.captured_at ?? row.capturedAt,
    serverUpdatedAt: row.server_updated_at ?? row.serverUpdatedAt ?? row.captured_at,
    expiresAt: row.expires_at ?? row.expiresAt ?? null
  };
}

function normalizeBroadcast(payload) {
  return normalizePoint(payload?.payload?.record || payload?.payload?.new || payload?.record || payload?.new || payload);
}

function rpcError(error, fallback) {
  return Object.assign(new Error(error?.message?.replace(/^.*?: /, '') || fallback), { code: error?.code });
}

function clientOrThrow() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Live tracking requires a configured Supabase connection.');
  return supabase;
}

async function rpc(name, params, fallback) {
  const client = clientOrThrow();
  const { data, error } = await client.rpc(name, params);
  if (error) throw rpcError(error, fallback);
  return data;
}

export function mapLiveLocationRow(row) {
  return normalizePoint(row);
}

export function isPointStale(point, now = Date.now()) {
  const timestamp = new Date(point?.serverUpdatedAt || point?.capturedAt || 0).getTime();
  return !Number.isFinite(timestamp) || now - timestamp >= LIVE_STALE_AFTER_MS;
}

export function isPointUnavailable(point, now = Date.now()) {
  const timestamp = new Date(point?.serverUpdatedAt || point?.capturedAt || 0).getTime();
  return !Number.isFinite(timestamp) || now - timestamp >= LIVE_UNAVAILABLE_AFTER_MS;
}

export const RideLiveTrackingService = {
  backend: isSupabaseConfigured ? 'supabase' : 'unconfigured',

  async startSharing(rideId, consentVersion = 'm2-live-v1') {
    return rpc('start_m2_location_sharing', { p_ride_id: rideId, p_consent_version: consentVersion }, 'Unable to start location sharing.');
  },

  async publishLocation(rideId, point) {
    const result = await rpc('publish_m2_live_location', {
      p_ride_id: rideId,
      p_latitude: Number(point.lat),
      p_longitude: Number(point.lng),
      p_accuracy_meters: Number(point.accuracyM),
      p_heading_degrees: point.headingDeg == null ? null : Number(point.headingDeg),
      p_speed_mps: point.speedMps == null ? null : Number(point.speedMps),
      p_captured_at: point.capturedAt || new Date().toISOString()
    }, 'Unable to publish your current location.');
    return result;
  },

  async stopSharing(rideId) {
    return rpc('stop_m2_location_sharing', { p_ride_id: rideId }, 'Unable to stop location sharing.');
  },

  async getLiveSnapshot(rideId) {
    const rows = await rpc('get_m2_live_locations', { p_ride_id: rideId }, 'Unable to load live locations.');
    return (rows || []).map(normalizePoint).filter(Boolean);
  },

  async getHistory(rideId, { after = null, limit = 2000 } = {}) {
    const rows = await rpc('get_m2_location_history', { p_ride_id: rideId, p_after: after, p_limit: limit }, 'Unable to load trip location history.');
    return (rows || []).map(normalizePoint).filter(Boolean);
  },

  async hideMyHistory(rideId) {
    return rpc('hide_m2_location_history', { p_ride_id: rideId }, 'Unable to hide your route history.');
  },

  async createFamilyShare(rideId) {
    return rpc('create_m2_family_location_share', { p_ride_id: rideId }, 'Unable to create a family location link.');
  },

  async revokeFamilyShare(shareId) {
    return rpc('revoke_m2_family_location_share', { p_share_id: shareId }, 'Unable to revoke the family location link.');
  },

  async consumeDynamicMapLoad(pageSessionId) {
    return rpc('consume_m2_dynamic_map_load', { p_page_session_id: pageSessionId }, 'Unable to check map availability.');
  },

  subscribeLive(rideId, { isDriver = false, onPoint = () => {}, onStatus = () => {} } = {}) {
    const client = clientOrThrow();
    const suffix = isDriver ? 'host' : 'driver';
    const channel = client
      .channel(`m2-live:${rideId}:${suffix}`, { config: { private: true } })
      .on('broadcast', { event: 'LOCATION' }, (payload) => {
        const point = normalizeBroadcast(payload);
        if (point) onPoint(point);
      })
      .subscribe((status) => onStatus(status));
    return () => { void client.removeChannel(channel); };
  },

  async observeLive(rideId, {
    isDriver = false,
    onSnapshot = () => {},
    onPoint = () => {},
    onStatus = () => {},
    documentObject = globalThis.document,
    windowObject = globalThis.window
  } = {}) {
    let stopped = false;
    let initialRefreshComplete = false;
    const refresh = async () => {
      const points = await RideLiveTrackingService.getLiveSnapshot(rideId);
      if (!stopped) onSnapshot(points);
    };
    const handleStatus = (status) => {
      onStatus(status);
      if (status === 'SUBSCRIBED' && initialRefreshComplete && !stopped) {
        void refresh().catch(() => onStatus('CHANNEL_ERROR'));
      }
    };
    const unsubscribe = RideLiveTrackingService.subscribeLive(rideId, {
      isDriver,
      onPoint,
      onStatus: handleStatus
    });
    const onResume = () => {
      if (!stopped && documentObject?.visibilityState !== 'hidden') {
        void refresh().catch(() => onStatus('CHANNEL_ERROR'));
      }
    };
    documentObject?.addEventListener?.('visibilitychange', onResume);
    windowObject?.addEventListener?.('focus', onResume);
    try {
      await refresh();
      initialRefreshComplete = true;
    } catch (error) {
      stopped = true;
      unsubscribe();
      documentObject?.removeEventListener?.('visibilitychange', onResume);
      windowObject?.removeEventListener?.('focus', onResume);
      throw error;
    }
    return () => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      documentObject?.removeEventListener?.('visibilitychange', onResume);
      windowObject?.removeEventListener?.('focus', onResume);
    };
  },

  createWatcher({
    rideId,
    onPoint = () => {},
    onState = () => {},
    sosMode = false,
    geolocation = globalThis.navigator?.geolocation,
    documentObject = globalThis.document,
    windowObject = globalThis.window
  } = {}) {
    let watchId = null;
    let lastSentAt = 0;
    let lastPointAt = 0;
    let stopped = false;
    let staleTimer = null;
    let latestPoint = null;

    const state = (value) => { if (!stopped) onState(value); };
    const publish = async (position) => {
      const coords = position?.coords || position;
      const point = {
        lat: Number(coords?.latitude),
        lng: Number(coords?.longitude),
        accuracyM: Number(coords?.accuracy),
        headingDeg: Number.isFinite(Number(coords?.heading)) ? Number(coords.heading) : null,
        speedMps: Number.isFinite(Number(coords?.speed)) ? Number(coords.speed) : null,
        capturedAt: new Date(position?.timestamp || Date.now()).toISOString()
      };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.accuracyM)) {
        state('inaccurate');
        return;
      }
      onPoint(point);
      latestPoint = point;
      lastPointAt = Date.now();
      if (Date.now() - lastSentAt < LIVE_UPLOAD_INTERVAL_MS) return;
      lastSentAt = Date.now();
      try { await RideLiveTrackingService.publishLocation(rideId, point); state('active'); }
      catch { state('offline'); }
    };
    const startWatch = () => {
      if (stopped || !geolocation?.watchPosition) { state('offline'); return; }
      state(documentObject?.visibilityState === 'hidden' ? (sosMode ? 'background' : 'paused') : 'starting');
      watchId = geolocation.watchPosition((position) => { void publish(position); }, () => state('offline'), {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
      });
    };
    const onVisibility = () => {
      if (stopped) return;
      if (documentObject?.visibilityState === 'hidden') {
        if (sosMode) {
          state('background');
        } else {
          if (watchId != null) geolocation?.clearWatch?.(watchId);
          watchId = null;
          state('paused');
        }
      } else {
        state('starting');
        if (watchId == null) startWatch();
      }
    };
    const retryLatest = () => {
      if (stopped) return;
      if (latestPoint && sosMode) {
        lastSentAt = 0;
        void RideLiveTrackingService.publishLocation(rideId, latestPoint)
          .then(() => state('active'))
          .catch(() => state('offline'));
      }
      if (watchId == null && documentObject?.visibilityState !== 'hidden') startWatch();
    };

    return {
      async start() {
        if (!geolocation?.watchPosition) {
          throw new Error('This browser cannot provide live location updates.');
        }
        await RideLiveTrackingService.startSharing(rideId);
        documentObject?.addEventListener?.('visibilitychange', onVisibility);
        windowObject?.addEventListener?.('focus', onVisibility);
        if (sosMode) windowObject?.addEventListener?.('online', retryLatest);
        staleTimer = windowObject?.setInterval?.(() => {
          if (!lastPointAt) return;
          const age = Date.now() - lastPointAt;
          if (age >= LIVE_UNAVAILABLE_AFTER_MS) state('offline');
          else if (age >= LIVE_STALE_AFTER_MS) state('stale');
        }, LIVE_STALE_AFTER_MS) || null;
        try {
          startWatch();
        } catch (error) {
          documentObject?.removeEventListener?.('visibilitychange', onVisibility);
          windowObject?.removeEventListener?.('focus', onVisibility);
          if (sosMode) windowObject?.removeEventListener?.('online', retryLatest);
          if (staleTimer != null) windowObject?.clearInterval?.(staleTimer);
          staleTimer = null;
          try { await RideLiveTrackingService.stopSharing(rideId); } catch { /* server TTL remains the safety net */ }
          throw error;
        }
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        if (watchId != null) geolocation?.clearWatch?.(watchId);
        if (staleTimer != null) windowObject?.clearInterval?.(staleTimer);
        documentObject?.removeEventListener?.('visibilitychange', onVisibility);
        windowObject?.removeEventListener?.('focus', onVisibility);
        if (sosMode) windowObject?.removeEventListener?.('online', retryLatest);
        try { await RideLiveTrackingService.stopSharing(rideId); } catch { /* server TTL remains the safety net */ }
      }
    };
  }
};
