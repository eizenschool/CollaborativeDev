import { useEffect, useRef, useState } from 'react';
import { RideSOSService } from '../../../business-logic/RideSOSService.js';
import { RideLiveTrackingService } from '../../../business-logic/RideLiveTrackingService.js';
import { IconAlertTriangle, IconCheckCircle } from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import { Field } from '../ui/Primitives.jsx';

export const SOS_HOLD_MS = 2_000;
export const SOS_CANCEL_SECONDS = 5;
export const SOS_SAFE_CONFIRMATION = 'I am safe';

export function matchesSOSSafeConfirmation(value) {
  return String(value || '').trim() === SOS_SAFE_CONFIRMATION;
}

function statusText(state) {
  return ({ active: 'GPS uploading', background: 'Background best effort', stale: 'GPS stale', offline: 'GPS unavailable', starting: 'Starting GPS' })[state] || 'Waiting for GPS';
}

export default function RideSOSPanel({ rideId, isHost, userId, onActiveChange = () => {} }) {
  const [event, setEvent] = useState(null);
  const [gpsState, setGpsState] = useState('waiting');
  const [countdown, setCountdown] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [safeConfirmation, setSafeConfirmation] = useState('');
  const holdTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const watcherRef = useRef(null);

  async function startSOSWatcher() {
    if (watcherRef.current) return;
    const watcher = RideLiveTrackingService.createWatcher({
      rideId,
      sosMode: true,
      onPoint: () => setGpsState('active'),
      onState: setGpsState
    });
    watcherRef.current = watcher;
    try {
      await watcher.start();
    } catch (watchError) {
      watcherRef.current = null;
      setGpsState('offline');
      setWarning(`SOS is active, but GPS could not start: ${watchError.message}`);
    }
  }

  useEffect(() => {
    let mounted = true;
    RideSOSService.getActive(rideId).then((activeEvent) => {
      if (!mounted || !activeEvent) return;
      setEvent(activeEvent);
      onActiveChange(true);
      void startSOSWatcher();
    }).catch(() => {});
    return () => {
      mounted = false;
      window.clearTimeout(holdTimerRef.current);
      window.clearInterval(countdownTimerRef.current);
      void watcherRef.current?.stop();
    };
  }, [rideId]);

  useEffect(() => {
    if (countdown == null) return undefined;
    if (countdown <= 0) {
      setCountdown(null);
      void activate();
      return undefined;
    }
    countdownTimerRef.current = window.setTimeout(() => setCountdown((value) => value - 1), 1_000);
    return () => window.clearTimeout(countdownTimerRef.current);
  }, [countdown]);

  function beginHold() {
    if (busy || event || countdown != null) return;
    setError('');
    holdTimerRef.current = window.setTimeout(() => setCountdown(SOS_CANCEL_SECONDS), SOS_HOLD_MS);
  }

  function cancelHold() {
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }

  async function activate() {
    setBusy(true);
    setError('');
    setWarning('');
    try {
      const activeEvent = await RideSOSService.activate(rideId);
      setEvent(activeEvent);
      onActiveChange(true);
      const warnings = [];
      if (!activeEvent.trustedFamilyCount) warnings.push('No trusted family members will receive this alert.');
      else if (!activeEvent.pushReadyCount) warnings.push('Your trusted family have no Push-ready devices; the alert is still in their notification centre.');
      setWarning(warnings.join(' '));
      await startSOSWatcher();
    } catch (activateError) {
      setError(activateError.message || 'Unable to activate SOS.');
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  async function resolve() {
    if (!event || !matchesSOSSafeConfirmation(safeConfirmation)) return;
    setBusy(true);
    setError('');
    try {
      await RideSOSService.resolve(event.eventId);
      await watcherRef.current?.stop();
      watcherRef.current = null;
      setEvent(null);
      setGpsState('waiting');
      setWarning('SOS resolved. Trusted family can no longer access your location.');
      onActiveChange(false);
      setDialog(null);
      setSafeConfirmation('');
    } catch (resolveError) {
      setError(resolveError.message || 'Unable to resolve SOS.');
    } finally {
      setBusy(false);
    }
  }

  function cancelCountdown() {
    setCountdown(null);
    setWarning('SOS activation cancelled.');
  }

  function openResolveDialog() {
    setSafeConfirmation('');
    setDialog('resolve');
  }

  function closeResolveDialog() {
    setSafeConfirmation('');
    setDialog(null);
  }

  function submitResolve(eventValue) {
    eventValue.preventDefault();
    if (!matchesSOSSafeConfirmation(safeConfirmation) || busy) return;
    void resolve();
  }

  const safeConfirmationMatches = matchesSOSSafeConfirmation(safeConfirmation);

  return <section className={`ride-info-card sos-panel ${event ? 'sos-panel-active' : ''}`}>
    <div className="trip-section-heading"><div><p className="eyebrow">EMERGENCY SOS</p><h2>{event ? 'SOS is active' : 'Get help from trusted family'}</h2></div><span className="sos-status-icon" aria-hidden="true">{event ? <IconAlertTriangle size={22} /> : <IconCheckCircle size={22} />}</span></div>
    {event ? <>
      <p className="sos-persistent-warning">The server alert remains active if this PWA is closed, but GPS updates may stop. Your last point is retained until you mark yourself safe.</p>
      <dl className="sos-stats"><div><dt>GPS</dt><dd>{statusText(gpsState)}</dd></div><div><dt>Trusted family</dt><dd>{event.trustedFamilyCount || 0}</dd></div><div><dt>Push-ready</dt><dd>{event.pushReadyCount || 0}</dd></div></dl>
      <Button variant="danger" onClick={openResolveDialog}>I&apos;m safe — end SOS</Button>
    </> : countdown != null ? <div className="sos-cancel-countdown" role="alert"><strong>Activating SOS in {countdown}…</strong><p>The server alert will start even if GPS or Push is unavailable.</p><Button variant="secondary" onClick={cancelCountdown}>Cancel SOS</Button></div> : <>
      <p>Press and hold for 2 seconds. You then have 5 seconds to cancel. Keyboard and assistive technology users can use the confirmation dialog.</p>
      <button type="button" className="sos-hold-button" disabled={busy} aria-describedby="sos-hold-help" onPointerDown={beginHold} onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold} onClick={(eventValue) => { if (eventValue.detail === 0) setDialog('activate'); }}><IconAlertTriangle size={22} aria-hidden="true" />{busy ? 'Activating SOS…' : 'Hold for SOS'}</button>
      <small id="sos-hold-help">Available to the Driver and accepted passengers from one hour before departure until the Ride ends.</small>
    </>}
    {warning && <div className="alert" role="status">{warning}</div>}
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    <AdaptiveDialog open={dialog === 'activate'} onClose={() => setDialog(null)} title="Activate SOS?" description="This accessible alternative activates the same server alert without requiring a hold gesture." footer={<Button variant="danger" loading={busy} onClick={activate}>Activate SOS now</Button>}><p>All active trusted family will receive an in-app alert and Web Push where enabled. The alert still starts if GPS, family, or Push is unavailable.</p></AdaptiveDialog>
    <AdaptiveDialog
      open={dialog === 'resolve'}
      onClose={closeResolveDialog}
      title="Are you safe?"
      description="Ending SOS immediately removes trusted family location access."
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={closeResolveDialog}>Keep SOS active</Button>
        <Button type="submit" form="sos-safe-confirm-form" loading={busy} loadingLabel="Ending SOS…" disabled={!safeConfirmationMatches}>Yes, I&apos;m safe</Button>
      </>}
    >
      <p>Your trusted family will receive a resolved notification. This cannot be undone, but you can activate a new SOS if needed.</p>
      <form id="sos-safe-confirm-form" className="sos-safe-confirm-form" onSubmit={submitResolve}>
        <Field
          htmlFor="sos-safe-confirmation"
          label="Safety confirmation"
          required
          hint={<>Type <strong>{SOS_SAFE_CONFIRMATION}</strong> exactly to enable the final button. The phrase is case-sensitive.</>}
        >
          <input
            id="sos-safe-confirmation"
            name="sos-safe-confirmation"
            type="text"
            value={safeConfirmation}
            onChange={(eventValue) => setSafeConfirmation(eventValue.target.value)}
            aria-describedby="sos-safe-confirmation-hint"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-autofocus
          />
        </Field>
      </form>
    </AdaptiveDialog>
  </section>;
}
