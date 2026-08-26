import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { RideLiveTrackingService } from '../RideLiveTrackingService.js';

const migration = new URL('../../../database/sql/061_m2_sos_trusted_family.sql', import.meta.url);
const advisorMigration = new URL('../../../database/sql/062_m2_sos_advisor_followup.sql', import.meta.url);
const sosPanel = new URL('../../presentation/components/ride/RideSOSPanel.jsx', import.meta.url);
const invitePage = new URL('../../presentation/components/ride/TrustedFamilyInvite.jsx', import.meta.url);
const familyPage = new URL('../../presentation/components/ride/SOSFamilyView.jsx', import.meta.url);
const familyMapPanel = new URL('../../presentation/components/ride/FamilyLiveMapPanel.jsx', import.meta.url);
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
    expect(worker).toContain('requireInteraction: isVoiceCall || isSOS');
  });

  it('provides accessible SOS confirmation and truthful degraded states', async () => {
    const [panel, invite, family, mapPanel] = await Promise.all([
      readFile(sosPanel, 'utf8'), readFile(invitePage, 'utf8'), readFile(familyPage, 'utf8'), readFile(familyMapPanel, 'utf8')
    ]);
    expect(panel).toContain('SOS_HOLD_MS = 2_000');
    expect(panel).toContain('SOS_CANCEL_SECONDS = 5');
    expect(panel).toContain('eventValue.detail === 0');
    expect(panel).toContain('SOS is active, but GPS could not start');
    expect(panel).toContain('No trusted family members will receive this alert.');
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
});
