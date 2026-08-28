import { useCallback, useEffect, useRef, useState } from 'react';
import { RideSOSService } from '../../../business-logic/RideSOSService.js';
import { RideLiveTrackingService } from '../../../business-logic/RideLiveTrackingService.js';

export const SOS_HOLD_MS = 2_000;
export const SOS_CANCEL_SECONDS = 5;
export const SOS_SAFE_CONFIRMATION = 'I am safe';

export function matchesSOSSafeConfirmation(value) {
  return String(value || '').trim() === SOS_SAFE_CONFIRMATION;
}

export function sosGpsStatusText(state) {
  return ({
    active: 'GPS uploading',
    background: 'Background best effort',
    stale: 'GPS stale',
    offline: 'GPS unavailable',
    starting: 'Starting GPS',
  })[state] || 'Waiting for GPS';
}

export default function useRideSOSController({ rideId, initialEvent = null, onActiveChange = () => {} }) {
  const [event, setEvent] = useState(initialEvent);
  const [gpsState, setGpsState] = useState('waiting');
  const [countdown, setCountdown] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [safeConfirmation, setSafeConfirmation] = useState('');
  const holdTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const watcherRef = useRef(null);
  const rideIdRef = useRef(rideId);
  const onActiveChangeRef = useRef(onActiveChange);
  const initialEventRef = useRef(initialEvent);
  rideIdRef.current = rideId;
  onActiveChangeRef.current = onActiveChange;

  const stopSOSWatcher = useCallback(async () => {
    const watcher = watcherRef.current;
    watcherRef.current = null;
    if (watcher) await watcher.stop();
  }, []);

  const startSOSWatcher = useCallback(async () => {
    if (!rideId || watcherRef.current) return;
    const watcherRideId = rideId;
    const watcher = RideLiveTrackingService.createWatcher({
      rideId: watcherRideId,
      sosMode: true,
      onPoint: () => {
        if (rideIdRef.current === watcherRideId) setGpsState('active');
      },
      onState: (nextState) => {
        if (rideIdRef.current === watcherRideId) setGpsState(nextState);
      },
    });
    watcherRef.current = watcher;
    try {
      await watcher.start();
    } catch (watchError) {
      if (watcherRef.current === watcher) watcherRef.current = null;
      if (rideIdRef.current !== watcherRideId) return;
      setGpsState('offline');
      setWarning(`SOS is active, but GPS could not start: ${watchError.message}`);
    }
  }, [rideId]);

  useEffect(() => {
    let mounted = true;
    const seededEvent = initialEventRef.current;
    setEvent(seededEvent);
    setGpsState('waiting');
    setCountdown(null);
    setBusy(false);
    setError('');
    setWarning('');
    setSafeConfirmation('');

    if (seededEvent) {
      onActiveChangeRef.current(true);
      void startSOSWatcher();
    } else if (rideId) {
      RideSOSService.getActive(rideId).then((activeEvent) => {
        if (!mounted) return;
        setEvent(activeEvent);
        onActiveChangeRef.current(Boolean(activeEvent));
        if (activeEvent) void startSOSWatcher();
      }).catch(() => {
        // The launcher remains available when the optional SOS backend is not
        // configured; activation will expose the actionable server error.
      });
    }

    return () => {
      mounted = false;
      window.clearTimeout(holdTimerRef.current);
      window.clearTimeout(countdownTimerRef.current);
      void stopSOSWatcher();
    };
  }, [rideId, startSOSWatcher, stopSOSWatcher]);

  const activate = useCallback(async () => {
    if (!rideId) return null;
    setBusy(true);
    setError('');
    setWarning('');
    try {
      const activeEvent = await RideSOSService.activate(rideId);
      setEvent(activeEvent);
      onActiveChangeRef.current(true);
      const warnings = [];
      if (!activeEvent.trustedFamilyCount) warnings.push('No trusted family members will receive this alert.');
      else if (!activeEvent.pushReadyCount) warnings.push('Your trusted family have no Push-ready devices; the alert is still in their notification centre.');
      setWarning(warnings.join(' '));
      await startSOSWatcher();
      return activeEvent;
    } catch (activateError) {
      setError(activateError.message || 'Unable to activate SOS.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [rideId, startSOSWatcher]);

  const resolve = useCallback(async () => {
    if (!event || !matchesSOSSafeConfirmation(safeConfirmation)) return false;
    setBusy(true);
    setError('');
    try {
      await RideSOSService.resolve(event.eventId);
      await stopSOSWatcher();
      setEvent(null);
      setGpsState('waiting');
      setWarning('SOS resolved. Trusted family can no longer access your location.');
      onActiveChangeRef.current(false);
      setSafeConfirmation('');
      return true;
    } catch (resolveError) {
      setError(resolveError.message || 'Unable to resolve SOS.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [event, safeConfirmation, stopSOSWatcher]);

  useEffect(() => {
    if (countdown == null) return undefined;
    if (countdown <= 0) {
      setCountdown(null);
      void activate();
      return undefined;
    }
    countdownTimerRef.current = window.setTimeout(() => setCountdown((value) => value - 1), 1_000);
    return () => window.clearTimeout(countdownTimerRef.current);
  }, [activate, countdown]);

  const beginHold = useCallback(() => {
    if (busy || event || countdown != null) return;
    setError('');
    holdTimerRef.current = window.setTimeout(() => setCountdown(SOS_CANCEL_SECONDS), SOS_HOLD_MS);
  }, [busy, countdown, event]);

  const cancelHold = useCallback(() => {
    window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);

  const cancelCountdown = useCallback(() => {
    setCountdown(null);
    setWarning('SOS activation cancelled.');
  }, []);

  return {
    event,
    gpsState,
    countdown,
    busy,
    error,
    warning,
    safeConfirmation,
    safeConfirmationMatches: matchesSOSSafeConfirmation(safeConfirmation),
    setSafeConfirmation,
    setError,
    setWarning,
    beginHold,
    cancelHold,
    cancelCountdown,
    activate,
    resolve,
  };
}
