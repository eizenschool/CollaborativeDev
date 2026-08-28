import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import { SOSLauncherService } from '../../../business-logic/SOSLauncherService.js';
import {
  hasShownSOSDockIntro,
  markSOSDockIntroShown,
  readSOSDockSide,
  writeSOSDockSide,
} from '../../../business-logic/SOSLauncherPreferences.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { IconAlertTriangle } from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import { Field } from '../ui/Primitives.jsx';
import useRideSOSController, {
  SOS_SAFE_CONFIRMATION,
  sosGpsStatusText,
} from './useRideSOSController.js';
import '../../styles/sos-launcher.css';

export const SOS_LAUNCHER_REFRESH_MS = 15_000;
export const SOS_DOCK_INTRO_MS = 4_000;

const SOSLauncherContext = createContext(null);

function candidateRoute(candidate) {
  return `${candidate.ride.pickup} → ${candidate.ride.destination}`;
}

function candidateDeparture(candidate) {
  const date = new Date(candidate.ride.departureAt);
  if (!Number.isFinite(date.getTime())) return 'Departure time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function isCurrentRideTripMode(location, candidates) {
  if (new URLSearchParams(location.search).get('view') !== 'trip') return false;
  const match = location.pathname.match(/^\/ride\/([^/]+)\/?$/);
  if (!match) return false;
  let rideId = match[1];
  try { rideId = decodeURIComponent(rideId); } catch { return false; }
  return candidates.some((candidate) => String(candidate.ride.id) === rideId);
}

export function SOSLauncherProvider({ children, enabled = true }) {
  const { user } = useAuth();
  const location = useLocation();
  const [candidates, setCandidates] = useState([]);
  const [selectedRideId, setSelectedRideId] = useState(null);
  const [selectionRideId, setSelectionRideId] = useState('');
  const [dialog, setDialog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [dockSide, setDockSide] = useState('right');
  const [introExpanded, setIntroExpanded] = useState(false);
  const selectedRideIdRef = useRef(selectedRideId);
  const refreshSequenceRef = useRef(0);
  const triggerRef = useRef(null);
  const introFallbackRef = useRef(new Set());
  selectedRideIdRef.current = selectedRideId;

  const refreshCandidates = useCallback(async () => {
    if (!enabled || !user?.id) {
      setCandidates([]);
      setSelectedRideId(null);
      setLoadError('');
      return;
    }
    const sequence = ++refreshSequenceRef.current;
    try {
      const nextCandidates = await SOSLauncherService.listCandidates(user.id, new Date());
      if (sequence !== refreshSequenceRef.current) return;
      setCandidates(nextCandidates);
      setLoadError('');

      const currentSelection = selectedRideIdRef.current;
      if (currentSelection && nextCandidates.some((candidate) => candidate.ride.id === currentSelection)) return;
      if (nextCandidates.length === 1) {
        setSelectedRideId(nextCandidates[0].ride.id);
        return;
      }
      setSelectedRideId(null);
      if (nextCandidates.length > 1) {
        const active = await SOSLauncherService.findActiveCandidate(nextCandidates);
        if (sequence !== refreshSequenceRef.current || !active) return;
        setSelectedRideId(active.candidate.ride.id);
      }
    } catch (requestError) {
      if (sequence !== refreshSequenceRef.current) return;
      setLoadError(requestError.message || 'Unable to refresh eligible SOS rides.');
    }
  }, [enabled, user?.id]);

  useEffect(() => {
    setDockSide(readSOSDockSide(user?.id));
  }, [user?.id]);

  useEffect(() => {
    void refreshCandidates();
  }, [location.pathname, location.search, refreshCandidates]);

  useEffect(() => {
    if (!enabled || !user) return undefined;
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refreshCandidates();
    };
    const timer = window.setInterval(refreshVisible, SOS_LAUNCHER_REFRESH_MS);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [enabled, refreshCandidates, user]);

  const selectedCandidate = candidates.find((candidate) => candidate.ride.id === selectedRideId) || null;
  const tripModeSuppressed = isCurrentRideTripMode(location, candidates);
  const visible = Boolean(enabled && user && candidates.length && !tripModeSuppressed);
  const controller = useRideSOSController({
    rideId: visible ? selectedCandidate?.ride.id || null : null,
  });

  useEffect(() => {
    if (!visible) setDialog(null);
  }, [visible]);

  useEffect(() => {
    if (controller.event && dialog === 'activate') setDialog('manage');
  }, [controller.event, dialog]);

  useEffect(() => {
    setIntroExpanded(false);
    if (!visible || !user?.id || controller.event) return undefined;
    const fallbackKey = String(user.id);
    if (introFallbackRef.current.has(fallbackKey) || hasShownSOSDockIntro(user.id)) return undefined;

    let remainingMs = SOS_DOCK_INTRO_MS;
    let startedAt = null;
    let timeoutId = null;
    let introStarted = false;

    const pause = () => {
      if (timeoutId == null || startedAt == null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
      startedAt = null;
    };

    const start = () => {
      if (document.visibilityState === 'hidden' || timeoutId != null || remainingMs <= 0) return;
      if (!introStarted) {
        introStarted = true;
        introFallbackRef.current.add(fallbackKey);
        markSOSDockIntroShown(user.id);
        setIntroExpanded(true);
      }
      startedAt = Date.now();
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        remainingMs = 0;
        startedAt = null;
        setIntroExpanded(false);
      }, remainingMs);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') pause();
      else start();
    };

    start();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibility);
      setIntroExpanded(false);
    };
  }, [Boolean(controller.event), user?.id, visible]);

  const changeDockSide = useCallback((side) => {
    setDockSide(writeSOSDockSide(user?.id, side));
  }, [user?.id]);

  const toggleDockSide = useCallback(() => {
    changeDockSide(dockSide === 'right' ? 'left' : 'right');
  }, [changeDockSide, dockSide]);

  const openLauncher = useCallback((triggerElement) => {
    triggerRef.current = triggerElement || null;
    if (!selectedCandidate) {
      setSelectionRideId('');
      setDialog('select');
      return;
    }
    setDialog(controller.event ? 'manage' : 'activate');
  }, [controller.event, selectedCandidate]);

  const closeDialog = useCallback(({ resetSelection = false } = {}) => {
    setDialog(null);
    if (resetSelection) setSelectedRideId(null);
  }, []);

  const confirmCandidateSelection = useCallback(() => {
    if (!selectionRideId) return;
    setSelectedRideId(selectionRideId);
    setDialog('activate');
  }, [selectionRideId]);

  const value = useMemo(() => ({
    candidates,
    selectedCandidate,
    selectedRideId,
    selectionRideId,
    setSelectionRideId,
    dialog,
    setDialog,
    loadError,
    dockSide,
    introExpanded,
    visible,
    controller,
    triggerRef,
    refreshCandidates,
    changeDockSide,
    toggleDockSide,
    openLauncher,
    closeDialog,
    confirmCandidateSelection,
  }), [
    candidates,
    changeDockSide,
    closeDialog,
    confirmCandidateSelection,
    controller,
    dialog,
    dockSide,
    introExpanded,
    loadError,
    openLauncher,
    refreshCandidates,
    selectedCandidate,
    selectedRideId,
    selectionRideId,
    toggleDockSide,
    visible,
  ]);

  return <SOSLauncherContext.Provider value={value}>{children}</SOSLauncherContext.Provider>;
}

export function useSOSLauncher() {
  const context = useContext(SOSLauncherContext);
  if (!context) throw new Error('useSOSLauncher must be used within SOSLauncherProvider');
  return context;
}

function SOSWarningMarker({ visible }) {
  return visible ? <span className="sos-launcher-warning-marker" aria-hidden="true" /> : null;
}

function SOSRefreshWarning() {
  const { loadError, refreshCandidates } = useSOSLauncher();
  if (!loadError) return null;
  return <div className="alert alert-error sos-launcher-refresh-warning" role="alert">
    <span>Ride status may be out of date. The last known SOS entry is still available.</span>
    <button type="button" className="btn-link" onClick={refreshCandidates}>Retry</button>
  </div>;
}

function SOSDockSideControl() {
  const { dockSide, toggleDockSide } = useSOSLauncher();
  const nextSide = dockSide === 'right' ? 'left' : 'right';
  return <div className="sos-dock-side-control">
    <span>Button position is saved on this device.</span>
    <button type="button" className="btn-link" onClick={toggleDockSide}>Move SOS to {nextSide} side</button>
  </div>;
}

function SOSRideSummary({ candidate }) {
  return <div className="global-sos-ride-summary">
    <span>{candidate.role === 'driver' ? 'Driver' : 'Passenger'} · {candidate.state.title}</span>
    <strong>{candidateRoute(candidate)}</strong>
    <small>{candidateDeparture(candidate)}</small>
  </div>;
}

function SOSLauncherDialogs() {
  const {
    candidates,
    selectedCandidate,
    selectionRideId,
    setSelectionRideId,
    dialog,
    setDialog,
    controller,
    triggerRef,
    refreshCandidates,
    closeDialog,
    confirmCandidateSelection,
  } = useSOSLauncher();

  async function activate() {
    if (await controller.activate()) {
      setDialog('manage');
      void refreshCandidates();
    }
  }

  function openResolve() {
    controller.setSafeConfirmation('');
    setDialog('resolve');
  }

  function closeResolve() {
    controller.setSafeConfirmation('');
    setDialog('manage');
  }

  async function resolve() {
    if (await controller.resolve()) {
      closeDialog({ resetSelection: candidates.length > 1 });
      void refreshCandidates();
    }
  }

  function submitResolve(eventValue) {
    eventValue.preventDefault();
    if (!controller.safeConfirmationMatches || controller.busy) return;
    void resolve();
  }

  if (!selectedCandidate) {
    return <AdaptiveDialog
      open={dialog === 'select'}
      onClose={() => closeDialog()}
      title="Choose the ride for SOS"
      description="You have more than one ride in the SOS availability window."
      triggerRef={triggerRef}
      footer={<>
        <Button variant="secondary" onClick={() => closeDialog()}>Cancel</Button>
        <Button variant="danger" disabled={!selectionRideId} onClick={confirmCandidateSelection}>Continue</Button>
      </>}
    >
      <SOSRefreshWarning />
      <fieldset className="global-sos-candidate-list">
        <legend>Select the ride where you need help</legend>
        {candidates.map((candidate) => <label key={candidate.ride.id}>
          <input type="radio" name="global-sos-ride" value={candidate.ride.id} checked={selectionRideId === candidate.ride.id} onChange={(eventValue) => setSelectionRideId(eventValue.target.value)} />
          <span><strong>{candidateRoute(candidate)}</strong><small>{candidate.role === 'driver' ? 'Driver' : 'Passenger'} · {candidate.state.title} · {candidateDeparture(candidate)}</small></span>
        </label>)}
      </fieldset>
      <SOSDockSideControl />
    </AdaptiveDialog>;
  }

  const resetSelection = candidates.length > 1;
  return <>
    <AdaptiveDialog
      open={dialog === 'activate'}
      onClose={() => closeDialog({ resetSelection })}
      title="Activate SOS?"
      description="Trusted family will be alerted for this ride after you confirm."
      triggerRef={triggerRef}
      footer={<>
        <Button variant="secondary" disabled={controller.busy} onClick={() => closeDialog({ resetSelection })}>Cancel</Button>
        <Button variant="danger" loading={controller.busy} loadingLabel="Activating SOS…" onClick={activate}>Activate SOS now</Button>
      </>}
    >
      <SOSRefreshWarning />
      <SOSRideSummary candidate={selectedCandidate} />
      <p>The server alert starts even if GPS, family, or Push is unavailable. Foreground GPS sharing will also start on this device.</p>
      {controller.error && <div className="alert alert-error" role="alert">{controller.error}</div>}
      <SOSDockSideControl />
    </AdaptiveDialog>

    <AdaptiveDialog
      open={dialog === 'manage'}
      onClose={() => closeDialog()}
      title="SOS is active"
      description="The server alert stays active until you mark yourself safe or the ride ends."
      triggerRef={triggerRef}
      footer={<Button variant="danger" onClick={openResolve}>I&apos;m safe — end SOS</Button>}
    >
      <SOSRefreshWarning />
      <SOSRideSummary candidate={selectedCandidate} />
      <p className="sos-persistent-warning">GPS updates are foreground best effort in this PWA. If the app is suspended, trusted family can still see the last uploaded point.</p>
      <dl className="sos-stats global-sos-stats"><div><dt>GPS</dt><dd>{sosGpsStatusText(controller.gpsState)}</dd></div><div><dt>Trusted family</dt><dd>{controller.event?.trustedFamilyCount || 0}</dd></div><div><dt>Push-ready</dt><dd>{controller.event?.pushReadyCount || 0}</dd></div></dl>
      {controller.warning && <div className="alert" role="status">{controller.warning}</div>}
      {controller.error && <div className="alert alert-error" role="alert">{controller.error}</div>}
      <SOSDockSideControl />
    </AdaptiveDialog>

    <AdaptiveDialog
      open={dialog === 'resolve'}
      onClose={closeResolve}
      title="Are you safe?"
      description="Ending SOS immediately removes trusted family location access."
      triggerRef={triggerRef}
      footer={<>
        <Button variant="secondary" disabled={controller.busy} onClick={closeResolve}>Keep SOS active</Button>
        <Button type="submit" form="global-sos-safe-confirm-form" loading={controller.busy} loadingLabel="Ending SOS…" disabled={!controller.safeConfirmationMatches}>Yes, I&apos;m safe</Button>
      </>}
    >
      <SOSRefreshWarning />
      <p>Your trusted family will receive a resolved notification. This cannot be undone, but you can activate a new SOS if needed.</p>
      <form id="global-sos-safe-confirm-form" className="sos-safe-confirm-form" onSubmit={submitResolve}>
        <Field
          htmlFor="global-sos-safe-confirmation"
          label="Safety confirmation"
          required
          hint={<>Type <strong>{SOS_SAFE_CONFIRMATION}</strong> exactly to enable the final button. The phrase is case-sensitive.</>}
        >
          <input
            id="global-sos-safe-confirmation"
            name="global-sos-safe-confirmation"
            type="text"
            value={controller.safeConfirmation}
            onChange={(eventValue) => controller.setSafeConfirmation(eventValue.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-autofocus
          />
        </Field>
      </form>
      {controller.error && <div className="alert alert-error" role="alert">{controller.error}</div>}
      <SOSDockSideControl />
    </AdaptiveDialog>
  </>;
}

export function TopNavSOSLauncher() {
  const { visible, controller, loadError, openLauncher } = useSOSLauncher();
  if (!visible) return null;
  const active = Boolean(controller.event);
  const label = active ? 'SOS active. Open SOS management.' : `Open emergency SOS${loadError ? '. Ride status may be out of date.' : ''}`;
  return <button
    type="button"
    className={`topnav-sos-button ${active ? 'is-active' : ''}`}
    aria-label={label}
    onClick={(eventValue) => openLauncher(eventValue.currentTarget)}
  >
    <IconAlertTriangle size={18} aria-hidden="true" />
    <span>{active ? 'SOS active' : 'SOS'}</span>
    <SOSWarningMarker visible={Boolean(loadError)} />
  </button>;
}

export default function GlobalSOSLauncher() {
  const {
    visible,
    dockSide,
    introExpanded,
    controller,
    loadError,
    openLauncher,
  } = useSOSLauncher();
  if (!visible) return null;
  const active = Boolean(controller.event);
  const expanded = active || introExpanded;
  const label = active ? 'SOS active. Open SOS management.' : `Open emergency SOS${loadError ? '. Ride status may be out of date.' : ''}`;

  return <>
    <div className={`global-sos-launcher dock-${dockSide}`}>
      <button
        type="button"
        className={`global-sos-button ${active ? 'is-active' : ''} ${expanded ? 'is-expanded' : 'is-compact'}`}
        aria-label={label}
        aria-expanded={expanded}
        onClick={(eventValue) => openLauncher(eventValue.currentTarget)}
      >
        <IconAlertTriangle size={21} aria-hidden="true" />
        <span className="global-sos-button__compact-label" aria-hidden="true">SOS</span>
        <span className="global-sos-button__expanded-label" aria-hidden="true">{active ? 'SOS active' : 'Emergency SOS'}</span>
        <SOSWarningMarker visible={Boolean(loadError)} />
      </button>
    </div>
    <SOSLauncherDialogs />
  </>;
}
