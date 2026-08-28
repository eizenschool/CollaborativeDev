import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RideSOSService } from '../../../business-logic/RideSOSService.js';
import { selectPendingSOSAlerts, sosRingRemainingMs } from '../../../business-logic/SOSAlertService.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useNotifications } from '../../../context/NotificationContext.jsx';
import { IconAlertTriangle, IconBell, IconMapPin } from '../icons.jsx';
import { Button } from '../ui/Button.jsx';
import '../../styles/sos-alert.css';

const SOS_ROUTE_PATTERN = /^\/sos\/([0-9a-f-]+)$/i;

function silencedStorageKey(userId) {
  return `m2-sos-silenced:${userId}`;
}

function readSilencedEventIds(userId) {
  if (!userId) return new Set();
  try {
    const value = JSON.parse(sessionStorage.getItem(silencedStorageKey(userId)) || '[]');
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function storeSilencedEventIds(userId, eventIds) {
  if (!userId) return;
  try {
    sessionStorage.setItem(silencedStorageKey(userId), JSON.stringify([...eventIds]));
  } catch {
    // Session-only suppression is optional; the urgent notification remains usable.
  }
}

export default function SOSAlertOverlay() {
  const { user } = useAuth();
  const {
    notifications,
    markRead,
    soundBlocked,
    startSOSRingtone,
    stopSOSRingtone,
    unlockAlertSounds,
  } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const routeAcknowledgementsRef = useRef(new Set());
  const [silencedEventIds, setSilencedEventIds] = useState(() => readSilencedEventIds(user?.id));
  const [inactiveEventIds, setInactiveEventIds] = useState(new Set());
  const [details, setDetails] = useState(null);
  const [detailsUnavailable, setDetailsUnavailable] = useState(false);

  useEffect(() => {
    setSilencedEventIds(readSilencedEventIds(user?.id));
    setInactiveEventIds(new Set());
    routeAcknowledgementsRef.current.clear();
  }, [user?.id]);

  const pendingAlerts = useMemo(
    () => selectPendingSOSAlerts(notifications)
      .filter((alert) => !inactiveEventIds.has(alert.eventId)),
    [inactiveEventIds, notifications],
  );
  const routeEventId = location.pathname.match(SOS_ROUTE_PATTERN)?.[1] || null;
  const actionableAlerts = pendingAlerts.filter((alert) => alert.eventId !== routeEventId);
  const modalAlert = actionableAlerts.find((alert) => !silencedEventIds.has(alert.eventId)) || null;
  const minimizedAlerts = actionableAlerts.filter((alert) => silencedEventIds.has(alert.eventId));
  const visibleAlert = modalAlert || minimizedAlerts[0] || null;

  const silenceAlert = useCallback((eventId) => {
    if (!eventId) return;
    stopSOSRingtone(eventId);
    setSilencedEventIds((current) => {
      if (current.has(eventId)) return current;
      const next = new Set(current);
      next.add(eventId);
      storeSilencedEventIds(user?.id, next);
      return next;
    });
  }, [stopSOSRingtone, user?.id]);

  const viewAlert = useCallback((alert) => {
    if (!alert) return;
    stopSOSRingtone(alert.eventId);
    void markRead(alert.id).catch(() => {});
    navigate(alert.actionPath);
  }, [markRead, navigate, stopSOSRingtone]);

  useEffect(() => {
    if (!routeEventId) return;
    const routeAlert = pendingAlerts.find((alert) => alert.eventId === routeEventId);
    if (!routeAlert || routeAcknowledgementsRef.current.has(routeAlert.id)) return;
    routeAcknowledgementsRef.current.add(routeAlert.id);
    stopSOSRingtone(routeAlert.eventId);
    void markRead(routeAlert.id).catch(() => {});
  }, [markRead, pendingAlerts, routeEventId, stopSOSRingtone]);

  useEffect(() => {
    if (!visibleAlert) {
      setDetails(null);
      setDetailsUnavailable(false);
      return undefined;
    }
    let active = true;
    setDetails(null);
    setDetailsUnavailable(false);
    RideSOSService.getFamilySnapshot(visibleAlert.eventId).then((snapshot) => {
      if (!active) return;
      if (snapshot?.status === 'resolved') {
        stopSOSRingtone(visibleAlert.eventId);
        setInactiveEventIds((current) => new Set(current).add(visibleAlert.eventId));
        return;
      }
      setDetails({
        personName: typeof snapshot?.personName === 'string' ? snapshot.personName : '',
        status: snapshot?.status || 'active',
      });
    }).catch(() => {
      if (active) setDetailsUnavailable(true);
    });
    return () => { active = false; };
  }, [stopSOSRingtone, visibleAlert?.eventId]);

  useEffect(() => {
    if (!modalAlert) return undefined;
    let timeoutId = null;
    const startForRemainingWindow = () => {
      const remainingMs = sosRingRemainingMs(modalAlert.createdAt);
      if (remainingMs <= 0) {
        silenceAlert(modalAlert.eventId);
        return;
      }
      startSOSRingtone(modalAlert.eventId);
      if (timeoutId != null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(
        () => silenceAlert(modalAlert.eventId),
        remainingMs,
      );
    };
    startForRemainingWindow();
    window.addEventListener('focus', startForRemainingWindow);
    document.addEventListener('visibilitychange', startForRemainingWindow);
    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
      window.removeEventListener('focus', startForRemainingWindow);
      document.removeEventListener('visibilitychange', startForRemainingWindow);
      stopSOSRingtone(modalAlert.eventId);
    };
  }, [modalAlert?.createdAt, modalAlert?.eventId, silenceAlert, startSOSRingtone, stopSOSRingtone]);

  useEffect(() => {
    if (!modalAlert) return undefined;
    returnFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => {
      (dialogRef.current?.querySelector('[data-sos-autofocus]') || dialogRef.current)?.focus();
    });
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        silenceAlert(modalAlert.eventId);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled)') || [])];
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [modalAlert?.eventId, silenceAlert]);

  if (!visibleAlert) return null;

  const personName = details?.personName || 'Your trusted family member';
  const pendingCount = actionableAlerts.length;

  if (!modalAlert) {
    return (
      <aside className="sos-alert-mini" aria-label={`Active SOS alert from ${personName}`} aria-live="polite">
        <span className="sos-alert-mini-icon" aria-hidden="true"><IconAlertTriangle size={22} /></span>
        <div className="sos-alert-mini-copy">
          <strong>{personName} needs help</strong>
          <span>Ringtone silenced · SOS still active</span>
        </div>
        {pendingCount > 1 && <span className="sos-alert-count" aria-label={`${pendingCount} active SOS alerts`}>{pendingCount}</span>}
        <Button size="small" variant="danger" onClick={() => viewAlert(visibleAlert)}>
          View SOS
        </Button>
      </aside>
    );
  }

  return (
    <div className="sos-alert-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="sos-alert-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sos-alert-title"
        aria-describedby="sos-alert-description"
        tabIndex={-1}
      >
        <div className="sos-alert-icon-ring" aria-hidden="true">
          <span><IconAlertTriangle size={42} /></span>
        </div>
        <div className="sos-alert-heading">
          <span className="sos-alert-eyebrow"><IconBell size={15} aria-hidden="true" /> Trusted Family SOS</span>
          <h2 id="sos-alert-title">{personName} needs help</h2>
          <p id="sos-alert-description">Open the latest authorized SOS location and contact them as soon as you can.</p>
        </div>

        <div className="sos-alert-status" role="status">
          <IconMapPin size={18} aria-hidden="true" />
          <span>{detailsUnavailable ? 'SOS is active. Details will load when opened.' : 'SOS active · View the latest available status and location on the secure SOS page'}</span>
        </div>

        {pendingCount > 1 && (
          <p className="sos-alert-queue" aria-live="polite">Newest alert shown · {pendingCount - 1} more active SOS alert{pendingCount === 2 ? '' : 's'} waiting</p>
        )}

        {soundBlocked && (
          <button
            type="button"
            className="sos-alert-enable-sound"
            onClick={async () => {
              if (await unlockAlertSounds()) startSOSRingtone(modalAlert.eventId);
            }}
          >
            Enable SOS sound in this browser
          </button>
        )}

        <div className="sos-alert-actions">
          <Button variant="secondary" onClick={() => silenceAlert(modalAlert.eventId)}>Silence</Button>
          <Button variant="danger" data-sos-autofocus onClick={() => viewAlert(modalAlert)}>View SOS</Button>
        </div>
        <p className="sos-alert-help">The ringtone stops after 45 seconds. Silencing does not resolve the SOS or mark the person safe.</p>
      </section>
    </div>
  );
}
