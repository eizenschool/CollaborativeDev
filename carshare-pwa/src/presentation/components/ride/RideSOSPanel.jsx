import { useState } from 'react';
import { IconAlertTriangle, IconCheckCircle } from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import { Field } from '../ui/Primitives.jsx';
import useRideSOSController, {
  matchesSOSSafeConfirmation,
  SOS_CANCEL_SECONDS,
  SOS_HOLD_MS,
  SOS_SAFE_CONFIRMATION,
  sosGpsStatusText,
} from './useRideSOSController.js';

export {
  matchesSOSSafeConfirmation,
  SOS_CANCEL_SECONDS,
  SOS_HOLD_MS,
  SOS_SAFE_CONFIRMATION,
};

export default function RideSOSPanel({ rideId, onActiveChange = () => {} }) {
  const [dialog, setDialog] = useState(null);
  const controller = useRideSOSController({ rideId, onActiveChange });

  async function activate() {
    await controller.activate();
    setDialog(null);
  }

  async function resolve() {
    if (await controller.resolve()) setDialog(null);
  }

  function openResolveDialog() {
    controller.setSafeConfirmation('');
    setDialog('resolve');
  }

  function closeResolveDialog() {
    controller.setSafeConfirmation('');
    setDialog(null);
  }

  function submitResolve(eventValue) {
    eventValue.preventDefault();
    if (!controller.safeConfirmationMatches || controller.busy) return;
    void resolve();
  }

  return <section className={`trip-safety-tool sos-panel ${controller.event ? 'sos-panel-active' : ''}`}>
    <div className="trip-section-heading"><div><p className="eyebrow">EMERGENCY SOS</p><h3>{controller.event ? 'SOS is active' : 'Get help from trusted family'}</h3></div><span className="sos-status-icon" aria-hidden="true">{controller.event ? <IconAlertTriangle size={22} /> : <IconCheckCircle size={22} />}</span></div>
    {controller.event ? <>
      <p className="sos-persistent-warning">The server alert remains active if this PWA is closed, but GPS updates may stop. Your last point is retained until you mark yourself safe.</p>
      <dl className="sos-stats"><div><dt>GPS</dt><dd>{sosGpsStatusText(controller.gpsState)}</dd></div><div><dt>Trusted family</dt><dd>{controller.event.trustedFamilyCount || 0}</dd></div><div><dt>Push-ready</dt><dd>{controller.event.pushReadyCount || 0}</dd></div></dl>
      <Button variant="danger" onClick={openResolveDialog}>I&apos;m safe — end SOS</Button>
    </> : controller.countdown != null ? <div className="sos-cancel-countdown" role="alert"><strong>Activating SOS in {controller.countdown}…</strong><p>The server alert will start even if GPS or Push is unavailable.</p><Button variant="secondary" onClick={controller.cancelCountdown}>Cancel SOS</Button></div> : <>
      <p>Hold for 2 seconds, then cancel within 5 seconds if needed. Keyboard and assistive technology users can confirm normally.</p>
      <button type="button" className="sos-hold-button" disabled={controller.busy} aria-describedby="sos-hold-help" onPointerDown={controller.beginHold} onPointerUp={controller.cancelHold} onPointerCancel={controller.cancelHold} onPointerLeave={controller.cancelHold} onClick={(eventValue) => { if (eventValue.detail === 0) setDialog('activate'); }}><IconAlertTriangle size={22} aria-hidden="true" />{controller.busy ? 'Activating SOS…' : 'Hold for SOS'}</button>
      <small id="sos-hold-help">Driver and accepted passengers · From one hour before departure until the Ride ends.</small>
    </>}
    {controller.warning && <div className="alert" role="status">{controller.warning}</div>}
    {controller.error && <div className="alert alert-error" role="alert">{controller.error}</div>}
    <AdaptiveDialog open={dialog === 'activate'} onClose={() => setDialog(null)} title="Activate SOS?" description="This accessible alternative activates the same server alert without requiring a hold gesture." footer={<Button variant="danger" loading={controller.busy} onClick={activate}>Activate SOS now</Button>}><p>All active trusted family will receive an in-app alert and Web Push where enabled. The alert still starts if GPS, family, or Push is unavailable.</p></AdaptiveDialog>
    <AdaptiveDialog
      open={dialog === 'resolve'}
      onClose={closeResolveDialog}
      title="Are you safe?"
      description="Ending SOS immediately removes trusted family location access."
      footer={<>
        <Button variant="secondary" disabled={controller.busy} onClick={closeResolveDialog}>Keep SOS active</Button>
        <Button type="submit" form="sos-safe-confirm-form" loading={controller.busy} loadingLabel="Ending SOS…" disabled={!controller.safeConfirmationMatches}>Yes, I&apos;m safe</Button>
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
            value={controller.safeConfirmation}
            onChange={(eventValue) => controller.setSafeConfirmation(eventValue.target.value)}
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
