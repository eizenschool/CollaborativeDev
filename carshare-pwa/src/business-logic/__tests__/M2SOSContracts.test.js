import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { RideLiveTrackingService } from '../RideLiveTrackingService.js';
import { matchesSOSSafeConfirmation, SOS_SAFE_CONFIRMATION } from '../../presentation/components/ride/RideSOSPanel.jsx';

const migration = new URL('../../../database/sql/061_m2_sos_trusted_family.sql', import.meta.url);
const advisorMigration = new URL('../../../database/sql/062_m2_sos_advisor_followup.sql', import.meta.url);
const sosPanel = new URL('../../presentation/components/ride/RideSOSPanel.jsx', import.meta.url);
const sosController = new URL('../../presentation/components/ride/useRideSOSController.js', import.meta.url);
const globalLauncher = new URL('../../presentation/components/ride/GlobalSOSLauncher.jsx', import.meta.url);
const globalLauncherStyles = new URL('../../presentation/styles/sos-launcher.css', import.meta.url);
const topNav = new URL('../../presentation/components/nav/TopNav.jsx', import.meta.url);
const main = new URL('../../main.jsx', import.meta.url);
const invitePage = new URL('../../presentation/components/ride/TrustedFamilyInvite.jsx', import.meta.url);
const familyPage = new URL('../../presentation/components/ride/SOSFamilyView.jsx', import.meta.url);
const familyMapPanel = new URL('../../presentation/components/ride/FamilyLiveMapPanel.jsx', import.meta.url);
const sosAlertOverlay = new URL('../../presentation/components/ride/SOSAlertOverlay.jsx', import.meta.url);
const notificationContext = new URL('../../context/NotificationContext.jsx', import.meta.url);
const serviceWorker = new URL('../../service-worker.js', import.meta.url);

describe('Module 2 trusted family and SOS contracts', () => {
  it('keeps trusted family and SOS data private behind narrow authenticated RPCs', async () => {
    const sql = await readFile(migration, 'utf8');
    for (const table of ['m2_trusted_family_invites', 'm2_trusted_family_links', 'm2_sos_events']) {
      expect(sql).toContain(`alter table private.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table private.${table} from public, anon, authenticated`);
    }
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('extensions.gen_random_bytes(32)');
    expect(sql).toContain("extensions.digest(p_token, 'sha256')");
    expect(sql).toContain("v_ride.departure_at - interval '1 hour'");
    expect(sql).toContain('private.m2_participant_role(p_ride_id, v_user_id)');
    expect(sql).toContain("raise exception 'Location sharing stays on during SOS");
    expect(sql).toContain("location_state = 'lost'");
    expect(sql).toContain("cleanup_after = now() + interval '24 hours'");
  });

  it('covers the foreign keys reported by the post-deployment advisor', async () => {
    const sql = await readFile(advisorMigration, 'utf8');
    expect(sql).toContain('m2_trusted_family_invites_owner_idx');
    expect(sql).toContain('m2_trusted_family_invites_claimed_by_idx');
    expect(sql).toContain('m2_sos_events_actor_idx');
  });

  it('reuses shared notification and Web Push boundaries without coordinates in payloads', async () => {
    const [sql, worker] = await Promise.all([readFile(migration, 'utf8'), readFile(serviceWorker, 'utf8')]);
    for (const eventType of ['sos_activated', 'sos_signal_lost', 'sos_signal_restored', 'sos_resolved']) {
      expect(sql).toContain(eventType);
    }
    expect(sql).toContain('private.create_user_notification(');
    expect(sql).toContain("jsonb_build_object('eventId', p_event_id)");
    expect(sql).not.toMatch(/jsonb_build_object\('eventId', p_event_id[^)]*(?:lat|lng|latitude|longitude)/i);
    expect(worker).toContain("payload.eventType.startsWith('sos_')");
    expect(worker).toContain("payload.eventType === 'sos_activated'");
    expect(worker).toContain('requireInteraction: isVoiceCall || isSOSActivation');
    expect(worker).toContain('silent: isSOSActivation ? false : undefined');
    expect(worker).toContain('renotify: isSOSActivation || undefined');
    expect(worker).toContain('`sos-${sosEventId}`');
    expect(worker).toContain("{ action: 'view-sos', title: 'View SOS' }");
    expect(worker).toContain("client.postMessage({ type: 'sos-push', eventId })");
    expect(worker).toContain('isSOSActivation ? broadcastSOSActivation(sosEventId) : undefined');
  });

  it('provides accessible SOS confirmation and truthful degraded states', async () => {
    const [panel, controller, invite, family, mapPanel] = await Promise.all([
      readFile(sosPanel, 'utf8'), readFile(sosController, 'utf8'), readFile(invitePage, 'utf8'), readFile(familyPage, 'utf8'), readFile(familyMapPanel, 'utf8')
    ]);
    expect(controller).toContain('SOS_HOLD_MS = 2_000');
    expect(controller).toContain('SOS_CANCEL_SECONDS = 5');
    expect(panel).toContain('eventValue.detail === 0');
    expect(controller).toContain('SOS is active, but GPS could not start');
    expect(controller).toContain('No trusted family members will receive this alert.');
    expect(panel).toContain('form="sos-safe-confirm-form"');
    expect(panel).toContain('disabled={!controller.safeConfirmationMatches}');
    expect(panel).toContain('aria-describedby="sos-safe-confirmation-hint"');
    expect(invite).toContain("sessionStorage.setItem(STORAGE_KEY");
    expect(invite).toContain('sessionStorage.removeItem(STORAGE_KEY)');
    expect(family).toContain('This page cannot end the SOS');
    expect(family).toContain('<FamilyLiveMapPanel');
    expect(family).toContain('last known location');
    expect(family).toContain('No GPS point has been received. The SOS itself is active, but this is not live location.');
    expect(family).not.toContain('navigator.geolocation');
    expect(mapPanel).toContain("import '../../styles/ride.css';");
    expect(mapPanel).toContain('aria-atomic="true"');
    expect(family).not.toContain('resolve_m2_sos');
  });

  it('adds a global, confirm-before-activate SOS launcher without duplicating Trip Mode tracking', async () => {
    const [launcher, controller, styles, mainSource, topNavSource] = await Promise.all([
      readFile(globalLauncher, 'utf8'),
      readFile(sosController, 'utf8'),
      readFile(globalLauncherStyles, 'utf8'),
      readFile(main, 'utf8'),
      readFile(topNav, 'utf8'),
    ]);
    expect(mainSource).toContain('<SOSLauncherProvider enabled={SOS_ENABLED}>');
    expect(mainSource).toContain('<GlobalSOSLauncher />');
    expect(topNavSource).toContain('<TopNavSOSLauncher />');
    expect(launcher).toContain('SOS_LAUNCHER_REFRESH_MS = 15_000');
    expect(launcher).not.toContain('SOS_DOCK_INTRO_MS');
    expect(launcher).not.toContain('introExpanded');
    expect(launcher).toContain('hasExceededSOSDragThreshold');
    expect(launcher).toContain('data-swipe-ignore');
    expect(launcher).toContain('setPointerCapture');
    expect(launcher).toContain('requestAnimationFrame');
    expect(launcher).toContain('sosDockPositionFromPoint');
    expect(launcher).toContain('rideId: visible ? selectedCandidate?.ride.id || null : null');
    expect(launcher.match(/useRideSOSController\(/g)).toHaveLength(1);
    expect(launcher).toContain("get('view') !== 'trip'");
    expect(launcher).toContain('Choose the ride for SOS');
    expect(launcher).toContain('disabled={!selectionRideId}');
    expect(launcher).toContain('Activate SOS now');
    expect(launcher).toContain('global-sos-safe-confirm-form');
    expect(launcher).toContain('Move SOS to {nextSide} side');
    expect(launcher).toContain('Move SOS up');
    expect(launcher).toContain('Move SOS down');
    expect(launcher).toContain('Reset SOS position');
    expect(launcher).toContain('Ride status may be out of date');
    expect(controller).toContain('if (!rideId || watcherRef.current) return');
    expect(styles).toContain('.global-sos-launcher { display: none; }');
    expect(styles).toContain('min-height: 44px');
    expect(styles).toContain('min-height: 56px');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('touch-action: none');
    expect(styles).toContain('z-index: calc(var(--z-nav) + 5)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('requires the exact typed safety phrase before SOS can be resolved', () => {
    expect(SOS_SAFE_CONFIRMATION).toBe('I am safe');
    expect(matchesSOSSafeConfirmation('I am safe')).toBe(true);
    expect(matchesSOSSafeConfirmation('  I am safe  ')).toBe(true);
    expect(matchesSOSSafeConfirmation('i am safe')).toBe(false);
    expect(matchesSOSSafeConfirmation("I'm safe")).toBe(false);
    expect(matchesSOSSafeConfirmation('')).toBe(false);
  });

  it('adds a privacy-safe, call-like foreground alert without creating a voice call', async () => {
    const [overlay, context] = await Promise.all([
      readFile(sosAlertOverlay, 'utf8'),
      readFile(notificationContext, 'utf8'),
    ]);
    expect(overlay).toContain('role="alertdialog"');
    expect(overlay).toContain('sosRingRemainingMs');
    expect(overlay).toContain('sessionStorage.setItem');
    expect(overlay).toContain('RideSOSService.getFamilySnapshot');
    expect(overlay).toContain('View SOS');
    expect(overlay).toContain('Silence');
    expect(overlay).not.toContain("document.visibilityState === 'hidden'");
    expect(overlay).toContain("document.addEventListener('visibilitychange', startForRemainingWindow)");
    expect(overlay).not.toMatch(/CallService|startCall|call_sessions/);
    expect(overlay).not.toMatch(/latitude|longitude|accuracyM|\blat\b|\blng\b/);
    expect(context).toContain('startSOSRingtone');
    expect(context).toContain('stopSOSRingtone');
    expect(context).toContain("eventValue.data?.type !== 'sos-push'");
    expect(context).toContain('requestedSOSEventRef.current !== eventId');
    expect(context).toContain("change.new?.event_type !== SOS_ACTIVATED_EVENT_TYPE");
  });

  it('keeps a geolocation watcher alive while hidden in SOS mode and retries on reconnect', async () => {
    const originals = {
      startSharing: RideLiveTrackingService.startSharing,
      publishLocation: RideLiveTrackingService.publishLocation,
      stopSharing: RideLiveTrackingService.stopSharing
    };
    const callbacks = [];
    const listeners = {};
    const geolocation = {
      watchPosition: vi.fn((success) => { callbacks.push(success); return 4; }),
      clearWatch: vi.fn()
    };
    const documentObject = {
      visibilityState: 'visible',
      addEventListener: vi.fn((name, handler) => { listeners[name] = handler; }),
      removeEventListener: vi.fn()
    };
    const windowObject = {
      addEventListener: vi.fn((name, handler) => { listeners[name] = handler; }),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 8),
      clearInterval: vi.fn()
    };
    RideLiveTrackingService.startSharing = vi.fn().mockResolvedValue('session');
    RideLiveTrackingService.publishLocation = vi.fn().mockResolvedValue({ accepted: true });
    RideLiveTrackingService.stopSharing = vi.fn().mockResolvedValue(true);
    try {
      const watcher = RideLiveTrackingService.createWatcher({ rideId: 'ride-1', sosMode: true, geolocation, documentObject, windowObject });
      await watcher.start();
      callbacks[0]({ coords: { latitude: 3.1, longitude: 101.6, accuracy: 12 }, timestamp: Date.now() });
      await vi.waitFor(() => expect(RideLiveTrackingService.publishLocation).toHaveBeenCalledOnce());
      documentObject.visibilityState = 'hidden';
      listeners.visibilitychange();
      expect(geolocation.clearWatch).not.toHaveBeenCalled();
      listeners.online();
      await vi.waitFor(() => expect(RideLiveTrackingService.publishLocation).toHaveBeenCalledTimes(2));
      await watcher.stop();
    } finally {
      Object.assign(RideLiveTrackingService, originals);
    }
  });

  it('does not attach a GPS watcher when cleanup wins a pending server start', async () => {
    const originals = {
      startSharing: RideLiveTrackingService.startSharing,
      stopSharing: RideLiveTrackingService.stopSharing,
    };
    let finishStart;
    const pendingStart = new Promise((resolve) => { finishStart = resolve; });
    const geolocation = {
      watchPosition: vi.fn(() => 7),
      clearWatch: vi.fn(),
    };
    const documentObject = {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const windowObject = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 9),
      clearInterval: vi.fn(),
    };
    RideLiveTrackingService.startSharing = vi.fn(() => pendingStart);
    RideLiveTrackingService.stopSharing = vi.fn().mockResolvedValue(true);
    try {
      const watcher = RideLiveTrackingService.createWatcher({
        rideId: 'ride-pending',
        sosMode: true,
        geolocation,
        documentObject,
        windowObject,
      });
      const startPromise = watcher.start();
      const stopPromise = watcher.stop();
      finishStart('session');
      await Promise.all([startPromise, stopPromise]);

      expect(geolocation.watchPosition).not.toHaveBeenCalled();
      expect(documentObject.addEventListener).not.toHaveBeenCalled();
      expect(windowObject.addEventListener).not.toHaveBeenCalled();
      expect(RideLiveTrackingService.stopSharing).toHaveBeenCalledTimes(2);
    } finally {
      Object.assign(RideLiveTrackingService, originals);
    }
  });
});
