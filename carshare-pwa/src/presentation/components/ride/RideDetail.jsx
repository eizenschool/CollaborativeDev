import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getAuthNavigation, normaliseInternalReturnPath } from '../../../business-logic/authAccess.js';
import { RideService } from '../../../business-logic/RideService.js';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import { RideReviewService } from '../../../business-logic/RideReviewService.js';
import { PlacePhotoService } from '../../../business-logic/PlacePhotoService.js';
import { RideLiveTrackingService, isPointStale, isPointUnavailable } from '../../../business-logic/RideLiveTrackingService.js';
import { isAtLeastHoursAway, isBeforeRideExpiry, REQUEST_CUTOFF_HOURS } from '../../../business-logic/rideDateTime.js';
import { GoogleMapsEmbedService } from '../../../business-logic/GoogleMapsEmbedService.js';
import { MessagingService } from '../../../business-logic/MessagingService.js';
import { formatJourneyCountdown, getRideJourneyState, isTripModeEligible, RIDE_ACTION } from '../../../business-logic/rideJourneyState.js';
import GoogleRouteMap from '../maps/GoogleRouteMap.jsx';
import LiveRideMap from '../maps/LiveRideMap.jsx';
import {
  IconAlertTriangle, IconArrowLeft, IconCalendar, IconCheck, IconEdit,
  IconClock, IconMapPin, IconMessage, IconPlus, IconRoute, IconShield, IconStar, IconUsers, IconX
} from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import { PickupPhotoPreview } from './PickupPhotoField.jsx';
import DestinationRidePhoto from './DestinationRidePhoto.jsx';
import RideSOSPanel from './RideSOSPanel.jsx';
import '../../styles/ride.css';

const LIFECYCLE = ['Draft', 'Published', 'Matched', 'In Transit', 'Completed'];
const LIVE_TRACKING_ENABLED = import.meta.env.VITE_M2_LIVE_TRACKING_ENABLED === 'true';
const SOS_ENABLED = import.meta.env.VITE_M2_SOS_ENABLED === 'true';

function initials(name) {
  return (name || 'Host').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function statusClass(status) {
  return `status-${String(status || '').toLowerCase().replaceAll(' ', '-')}`;
}

function MobileHeader({ title, onBack }) {
  return (
    <header className="mobile-page-header">
      <button className="round-icon-button" onClick={onBack} aria-label="Go back"><IconArrowLeft size={18} /></button>
      <h1>{title}</h1>
    </header>
  );
}

function RouteMap({ ride }) {
  return (
    <GoogleRouteMap pickup={ride.pickup} pickupLocation={ride.pickupLocation} destination={ride.destination} destinationLocation={ride.destinationLocation} waypoints={ride.waypoints} className="ride-map">
      <span className="map-grid map-grid-a" />
      <span className="map-grid map-grid-b" />
      <span className="map-route" />
      <span className="map-point map-point-start" />
      <span className="map-point map-point-end" />
      <span className="map-label map-label-start">{ride.pickup?.split(',')[0]}</span>
      <span className="map-label map-label-end">{ride.destination?.split(',')[0]}</span>
    </GoogleRouteMap>
  );
}

function Lifecycle({ status }) {
  const active = LIFECYCLE.indexOf(status);
  const cancelled = ['Cancelled', 'Expired'].includes(status);
  return (
    <div className="lifecycle" aria-label={`Ride status: ${status}`}>
      {LIFECYCLE.map((label, index) => (
        <div className="lifecycle-step" key={label}>
          <span className={`lifecycle-dot ${!cancelled && index <= active ? 'done' : ''}`}>{index < active && !cancelled ? <IconCheck size={11} /> : index + 1}</span>
          <span className={!cancelled && index === active ? 'active' : ''}>{label}</span>
          {index < LIFECYCLE.length - 1 && <i className={!cancelled && index < active ? 'filled' : ''} />}
        </div>
      ))}
      {cancelled && <span className={`ride-status-badge ${statusClass(status)}`}>{status}</span>}
    </div>
  );
}

function HostIdentity({ ride }) {
  const host = ride.host || { fullName: 'Let’s Tumpang Host', rating: 4.8, reputationScore: 75 };
  const rating = host.rating ?? 4.8;
  const tier = (host.reputationScore || 0) >= 80 ? 'Gold' : (host.reputationScore || 0) >= 60 ? 'Silver' : 'Bronze';
  return (
    <section className="ride-info-card host-card-mobile">
      <p className="eyebrow">HOST</p>
      <div className="host-profile-row">
        <span className="host-avatar-large" style={host.profilePhotoUrl ? { backgroundImage: `url(${host.profilePhotoUrl})` } : undefined}>
          {!host.profilePhotoUrl && initials(host.fullName)}
        </span>
        <span className="host-profile-text">
          <strong>{host.fullName}</strong>
          <span><IconStar size={13} /> {Number(rating).toFixed(1)} <b className="tier-badge">{tier}</b></span>
        </span>
        <span className="chevron">›</span>
      </div>
    </section>
  );
}

function WaypointPhoto({ waypoint }) {
  const [photo, setPhoto] = useState(null);
  const [failed, setFailed] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef(null);
  const freshLoaderRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return undefined;
    let active = true;
    setPhoto(null);
    setFailed(false);
    freshLoaderRef.current = null;
    (async () => {
      try {
        const loadFreshPhoto = async () => {
          const fresh = await PlacePhotoService.resolveFresh(waypoint.placeId, { label: waypoint.name, maxWidth: 600 });
          if (!fresh?.url) throw new Error('No waypoint photo');
          if (active) setPhoto(fresh);
        };
        freshLoaderRef.current = loadFreshPhoto;
        const resolved = await PlacePhotoService.resolve(waypoint.placeId, { label: waypoint.name, maxWidth: 600 });
        if (!resolved?.url) throw new Error('No waypoint photo');
        if (active) setPhoto(resolved);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; freshLoaderRef.current = null; };
  }, [inView, waypoint.placeId]);

  if (failed || !photo?.url) return <div className="waypoint-art" ref={containerRef} aria-hidden="true"><IconMapPin size={30} /></div>;
  const sourceUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(waypoint.name || 'Waypoint')}&query_place_id=${encodeURIComponent(waypoint.placeId || '')}`;
  const attributionName = typeof photo.attribution === 'string' ? photo.attribution : photo.attribution?.displayName;
  const attributionUri = typeof photo.attribution === 'object' ? photo.attribution?.uri : null;
  return <div className="waypoint-photo-wrap" ref={containerRef}><img src={photo.url} alt={`View of ${waypoint.name || 'this waypoint'}`} loading="lazy" onError={() => {
    if (photo.cached && freshLoaderRef.current) {
      setPhoto(null);
      freshLoaderRef.current().catch(() => setFailed(true));
    } else setFailed(true);
  }} /><small className="waypoint-photo-attribution"><span>{attributionName && <>Photo by {attributionUri ? <a href={attributionUri} target="_blank" rel="noreferrer">{attributionName}</a> : attributionName}</>}</span><a href={sourceUrl} target="_blank" rel="noreferrer">Google Maps</a></small></div>;
}

function LiveTrackingPanel({ ride, isHost, userId, sosActive = false }) {
  const [sharing, setSharing] = useState(false);
  const [state, setState] = useState('off');
  const [points, setPoints] = useState([]);
  const [error, setError] = useState('');
  const [connectionWarning, setConnectionWarning] = useState('');
  const [familyLink, setFamilyLink] = useState('');
  const [familyShareId, setFamilyShareId] = useState('');
  const [pageSessionId] = useState(() => globalThis.crypto?.randomUUID?.() || `map-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [clock, setClock] = useState(() => Date.now());
  const watcherRef = useRef(null);
  const observerCleanupRef = useRef(null);

  const mergePoint = useCallback((point) => {
    setPoints((current) => {
      const next = current.filter((item) => item.userId !== point.userId);
      return [...next, point];
    });
  }, []);

  useEffect(() => {
    if (!LIVE_TRACKING_ENABLED) return undefined;
    let active = true;
    const intervalId = window.setInterval(() => setClock(Date.now()), 10_000);
    RideLiveTrackingService.observeLive(ride.id, {
      isDriver: isHost,
      onSnapshot: (snapshot) => { if (active) setPoints(snapshot); },
      onPoint: mergePoint,
      onStatus: (status) => {
        if (active && ['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
          setConnectionWarning('Live location updates are reconnecting.');
        } else if (active && status === 'SUBSCRIBED') {
          setConnectionWarning('');
        }
      }
    }).then((cleanup) => {
      if (active) observerCleanupRef.current = cleanup;
      else cleanup();
    }).catch((observeError) => {
      if (active) setError(observeError.message || 'Unable to load live locations.');
    });
    return () => {
      active = false;
      window.clearInterval(intervalId);
      observerCleanupRef.current?.();
      observerCleanupRef.current = null;
    };
  }, [isHost, mergePoint, ride.id]);

  useEffect(() => () => { void watcherRef.current?.stop(); }, []);

  async function start() {
    const audience = isHost
      ? 'yourself and accepted passengers'
      : 'yourself and the Driver';
    if (!window.confirm(`Start live location sharing? Your latest location will be visible to ${audience}. Sampled history is visible to accepted ride participants after the trip; family links never receive history. Keep this trip screen open because background tracking is best effort.`)) return;
    setError('');
    try {
      const watcher = RideLiveTrackingService.createWatcher({
        rideId: ride.id,
        onPoint: (point) => mergePoint({
          ...point,
          userId: userId || 'self',
          role: isHost ? 'Driver' : 'Passenger'
        }),
        onState: setState
      });
      watcherRef.current = watcher;
      await watcher.start();
      setSharing(true);
    } catch (startError) {
      setError(startError.message || 'Live location is unavailable right now.');
      setState('offline');
    }
  }

  async function stop() {
    if (sosActive) {
      setError("Location sharing stays on during SOS. Use I'm safe to end the alert.");
      return;
    }
    await watcherRef.current?.stop();
    watcherRef.current = null;
    setSharing(false);
    setState('off');
  }

  async function createFamilyLink() {
    setError('');
    try {
      const result = await RideLiveTrackingService.createFamilyShare(ride.id);
      const token = encodeURIComponent(result.token);
      setFamilyShareId(result.shareId || '');
      setFamilyLink(`${window.location.origin}/share/ride-location#token=${token}`);
    } catch (shareError) { setError(shareError.message || 'Unable to create a family link.'); }
  }

  async function revokeFamilyLink() {
    if (!familyShareId) return;
    setError('');
    try {
      await RideLiveTrackingService.revokeFamilyShare(familyShareId);
      setFamilyShareId('');
      setFamilyLink('');
    } catch (shareError) { setError(shareError.message || 'Unable to revoke the family link.'); }
  }

  async function shareFamilyLink() {
    if (!familyLink) return;
    try {
      if (navigator.share) await navigator.share({ title: "Let's Tumpang Ride location", url: familyLink });
      else await navigator.clipboard.writeText(familyLink);
    } catch (shareError) {
      if (shareError?.name !== 'AbortError') setError('Unable to share automatically. Copy the link manually.');
    }
  }

  if (!LIVE_TRACKING_ENABLED) return null;
  const visiblePoints = points
    .filter((point) => !isPointUnavailable(point, clock))
    .filter((point) => isHost || point.role === 'Driver' || point.userId === userId || point.userId === 'self')
    .sort((left, right) => (left.role === 'Driver' ? -1 : 0) - (right.role === 'Driver' ? -1 : 0));
  const unavailableDriver = !isHost && points.some((point) => point.role === 'Driver' && isPointUnavailable(point, clock));
  return <section className="trip-safety-tool live-tracking-panel">
    <div className="trip-section-heading"><div><p className="eyebrow">LIVE LOCATION</p><h3>{sharing ? 'Your sharing is on' : 'Your sharing is off'}</h3></div><span className={`tracking-state tracking-${state}`}>{state}</span></div>
    <p className="live-tracking-copy">Share your latest position or view the Driver. Passengers never see one another; background GPS is best effort.</p>
    {error && <p className="location-field-message error" role="alert">{error}</p>}
    {connectionWarning && <p className="location-field-message" role="status">{connectionWarning}</p>}
    {sharing ? <button type="button" className="btn-secondary full" onClick={stop} disabled={sosActive}>{sosActive ? 'Sharing locked during SOS' : 'Stop sharing'}</button> : <button type="button" className="primary-action full" onClick={start}>Start sharing</button>}
    <div className={`family-link-control ${isHost ? 'is-driver-note' : ''}`} aria-labelledby="trip-family-link-title">
      <span className="family-link-control-icon" aria-hidden="true"><IconUsers size={18} /></span>
      <span className="family-link-control-copy">
        <strong id="trip-family-link-title">Family Link</strong>
        <small>{isHost ? 'Accepted passengers create their own private link. Start sharing so their link can include your Driver location.' : 'Create a private, trip-only link showing your latest location and an actively sharing Driver.'}</small>
      </span>
      {!isHost && (familyLink ? <span className="family-link-ready"><IconCheck size={14} aria-hidden="true" /> Link ready</span> : <button type="button" className="outline-action" onClick={createFamilyLink}>Create family link</button>)}
    </div>
    {familyLink && <div className="family-share-result"><label htmlFor="family-location-link">Family link</label><input id="family-location-link" readOnly value={familyLink} onFocus={(event) => event.currentTarget.select()} /><small>Expires after the ride ends or departure +24 hours.</small><div className="family-share-actions"><button type="button" className="outline-action" onClick={shareFamilyLink}>Copy / Share</button><button type="button" className="btn-link" onClick={revokeFamilyLink}>Revoke family link</button></div></div>}
    {visiblePoints.length > 0 && <LiveRideMap ride={ride} points={visiblePoints} pageSessionId={pageSessionId} />}
    <div className="live-location-list" aria-live="polite">{visiblePoints.length ? visiblePoints.map((point) => <div key={point.userId || point.role}><span><strong>{point.role === 'Driver' ? 'Driver’s current location' : 'Passenger current location'}</strong><small>{isPointStale(point, clock) ? 'Stale location' : `±${Math.round(point.accuracyM)} m accuracy`}</small></span><a href={`https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a></div>) : <small>{unavailableDriver ? 'Driver location is temporarily unavailable.' : 'No active location is being shared.'}</small>}</div>
  </section>;
}

function TripModeView({
  ride, journeyState, isHost, userId, activeRequest, hostRequests, lifecycleContext,
  lifecycleBusy, notice, error, clock, onLifecycle, onDetails, onBack, onManageRequests, onTripChat
}) {
  const [sosActive, setSosActive] = useState(false);
  const accepted = hostRequests.filter((request) => request.status === 'Accepted');
  const pending = hostRequests.filter((request) => request.status === 'Pending');
  const departureReached = new Date(ride.departureAt) <= clock;
  const mapsUrl = GoogleMapsEmbedService.buildGoogleMapsDirectionsUrl({ pickup: ride.pickup, pickupLocation: ride.pickupLocation, destination: ride.destination, destinationLocation: ride.destinationLocation, waypoints: ride.waypoints });
  const checkedInCount = accepted.filter((request) => request.boardingStatus === 'Checked In').length;
  const unresolvedCount = accepted.filter((request) => request.boardingStatus === 'Pending').length;

  return <main className="phone-ride-page ride-detail-page trip-mode-page">
    <header className="trip-mode-header"><button className="round-icon-button" type="button" onClick={onBack} aria-label="Go back"><IconArrowLeft size={18} /></button><div><p className="eyebrow">TRIP MODE · {isHost ? 'DRIVER' : 'PASSENGER'}</p><h1>{ride.pickup?.split(',')[0]} → {ride.destination?.split(',')[0]}</h1></div><button type="button" className="btn-link" onClick={onDetails}>View ride details</button></header>
    <div className="trip-mode-content">
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      <section className="trip-overview-grid" aria-label="Current trip overview">
        <div className="trip-overview-command">
          <section className={`trip-command-card urgency-${journeyState.urgency}`} aria-live="polite">
            <div className="trip-command-meta"><span className={`ride-status-badge ${statusClass(ride.status)}`}>{ride.status}</span>{journeyState.countdownAt && <strong className="trip-countdown"><IconClock size={15} aria-hidden="true" />{formatJourneyCountdown(journeyState.countdownAt, clock, journeyState.countdownKind)}</strong>}</div>
            <h2>{journeyState.title}</h2><p>{journeyState.description}</p>{journeyState.blockers.map((blocker) => <small key={blocker}>{blocker}</small>)}
          </section>
          <section className="trip-mode-actions" aria-label="Trip actions">
            {!isHost && journeyState.nextAction.id === RIDE_ACTION.CHECK_IN && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('check-in', () => RideRequestService.checkIn(activeRequest.id))}>{lifecycleBusy === 'check-in' ? 'Checking GPS…' : 'Check in near pickup'}</button>}
            {isHost && journeyState.nextAction.id === RIDE_ACTION.START_RIDE && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('start', () => RideService.startRide(ride.id))}>{lifecycleBusy === 'start' ? 'Recalculating ETA…' : journeyState.nextAction.label}</button>}
            {isHost && ride.status === 'In Transit' && !lifecycleContext?.driverArrivedAt && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('driver-arrival', () => RideService.confirmDriverArrival(ride.id))}>{lifecycleBusy === 'driver-arrival' ? 'Checking GPS…' : 'Confirm destination arrival'}</button>}
            {!isHost && journeyState.nextAction.id === RIDE_ACTION.CONFIRM_PASSENGER_ARRIVAL && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('passenger-arrival', () => RideRequestService.confirmArrival(activeRequest.id))}>{lifecycleBusy === 'passenger-arrival' ? 'Confirming…' : 'Confirm I arrived'}</button>}
            {isHost && departureReached && unresolvedCount > 0 && journeyState.nextAction.id !== RIDE_ACTION.START_RIDE && <button type="button" className="btn-secondary full" onClick={onManageRequests}>Resolve all passengers</button>}
            <a className="outline-action full" href={mapsUrl} target="_blank" rel="noreferrer" aria-label="Open route in Google Maps"><IconRoute size={16} aria-hidden="true" /> Directions</a>
            <button type="button" className="outline-action full" onClick={onTripChat}><IconMessage size={16} aria-hidden="true" /> Trip chat</button>
          </section>
        </div>
        <div className="trip-overview-route">
          <section className="trip-route-card"><RouteMap ride={ride} /><div><p><strong>{ride.pickup}</strong><span>Pickup</span></p><p><strong>{ride.destination}</strong><span>Destination</span></p>{ride.status === 'In Transit' && ride.estimatedArrivalAt && <p><strong>{formatDateTime(ride.estimatedArrivalAt)}</strong><span>Updated traffic ETA</span></p>}</div></section>
          {ride.pickupInstructions && <section className="ride-info-card pickup-instructions-card"><p className="eyebrow">PICKUP INSTRUCTIONS</p><p><IconMapPin size={15} aria-hidden="true" /> {ride.pickupInstructions}</p></section>}
        </div>
      </section>

      <section className={`trip-support-grid ${SOS_ENABLED || LIVE_TRACKING_ENABLED ? '' : 'is-single'}`} aria-label="Trip support">
        {isHost && <section className="ride-info-card trip-readiness-card"><div className="trip-section-heading"><div><p className="eyebrow">PASSENGER READINESS</p><h2>{checkedInCount} of {accepted.length} checked in</h2></div>{pending.length > 0 && <button type="button" className="btn-link" onClick={onManageRequests}>{pending.length} pending request{pending.length === 1 ? '' : 's'}</button>}</div>{accepted.length ? <div className="trip-passenger-list">{accepted.map((request) => <div key={request.id}><span><strong>{request.requester?.fullName || 'Passenger'}</strong><small>{request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'}</small></span><b className={`boarding-state boarding-${request.boardingStatus.toLowerCase().replaceAll(' ', '-')}`}>{request.boardingStatus}</b>{request.boardingStatus === 'Pending' && departureReached && <button type="button" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle(`no-show-${request.id}`, () => RideRequestService.markNoShow(request.id))}>{lifecycleBusy === `no-show-${request.id}` ? 'Working…' : 'Mark No-show'}</button>}</div>)}</div> : <p>No accepted passengers yet.</p>}</section>}
        {!isHost && activeRequest && <section className="ride-info-card trip-passenger-status"><p className="eyebrow">YOUR BOARDING STATUS</p><h2>{activeRequest.boardingStatus}</h2>{activeRequest.checkedInAt && <p>Checked in {formatDateTime(activeRequest.checkedInAt)}</p>}{activeRequest.checkInDistanceMeters != null && <small>{activeRequest.checkInDistanceMeters} m from pickup{activeRequest.checkInAccuracyMeters != null ? ` · GPS ±${activeRequest.checkInAccuracyMeters} m` : ''}</small>}</section>}
        {(SOS_ENABLED || LIVE_TRACKING_ENABLED) && <section className={`trip-safety-hub ${sosActive ? 'is-sos-active' : ''}`} aria-labelledby="trip-safety-title">
          <header className="trip-safety-hub-header">
            <span className="trip-safety-hub-icon" aria-hidden="true"><IconShield size={23} /></span>
            <div><p className="eyebrow">RIDE SAFETY</p><h2 id="trip-safety-title">Safety &amp; live sharing</h2><p>Share your trip or alert trusted family when you need help.</p></div>
            {sosActive && <span className="trip-safety-hub-status"><IconAlertTriangle size={14} aria-hidden="true" /> SOS active</span>}
          </header>
          <div className={`trip-safety-grid ${SOS_ENABLED && LIVE_TRACKING_ENABLED ? '' : 'is-single'}`}>
            {SOS_ENABLED && <RideSOSPanel rideId={ride.id} isHost={isHost} userId={userId} onActiveChange={setSosActive} />}
            {LIVE_TRACKING_ENABLED && <LiveTrackingPanel ride={ride} isHost={isHost} userId={userId} sosActive={sosActive} />}
          </div>
        </section>}
      </section>

    </div>
  </main>;
}

function CancelSheet({ onDismiss, onConfirm }) {
  const [reason, setReason] = useState('');
  const reasons = ['Change of plans', 'Vehicle issue', 'Emergency', 'Other'];
  return (
    <AdaptiveDialog
      open
      onClose={onDismiss}
      title="Cancel this ride?"
      description="Let passengers know why this ride is no longer available."
      footer={<Button variant="danger" disabled={!reason} onClick={() => onConfirm(reason)}>Confirm cancellation</Button>}
    >
      <div className="reason-list" aria-label="Cancellation reason">
        {reasons.map((item) => <button type="button" aria-pressed={reason === item} className={reason === item ? 'selected' : ''} key={item} onClick={() => setReason(item)}><i aria-hidden="true" />{item}</button>)}
      </div>
    </AdaptiveDialog>
  );
}

function RequestSheet({ ride, onDismiss, onSubmit, saving, error }) {
  const [seatsRequested, setSeatsRequested] = useState(1);
  const [companionNames, setCompanionNames] = useState([]);
  function setSeats(value) {
    const next = Math.max(1, Math.min(ride.seatsAvailable, value));
    setSeatsRequested(next);
    setCompanionNames((names) => Array.from({ length: next - 1 }, (_, index) => names[index] || ''));
  }
  return (
    <AdaptiveDialog
      open
      onClose={onDismiss}
      title="Request to join"
      description="Seats include you. Pending requests do not reserve seats until the Host accepts them."
      footer={<Button loading={saving} loadingLabel="Sending request" disabled={companionNames.some((name) => !name.trim())} onClick={() => onSubmit({ seatsRequested, companionNames })}>{`Request ${seatsRequested} seat${seatsRequested === 1 ? '' : 's'}`}</Button>}
    >
      <div className="field"><label>Seats requested</label><div className="seat-stepper" aria-label="Seats requested"><button type="button" aria-label="Decrease requested seats" onClick={() => setSeats(seatsRequested - 1)}>−</button><output aria-live="polite">{seatsRequested}</output><button type="button" aria-label="Increase requested seats" onClick={() => setSeats(seatsRequested + 1)}>+</button></div></div>
      {companionNames.map((name, index) => <div className="field" key={index}><label htmlFor={`companion-${index}`}>Companion {index + 1} name</label><input id={`companion-${index}`} value={name} onChange={(event) => setCompanionNames((names) => names.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></div>)}
      {error && <div className="alert alert-error sheet-error" role="alert">{error}</div>}
    </AdaptiveDialog>
  );
}

export default function RideDetail() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeRequest, setActiveRequest] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [lifecycleContext, setLifecycleContext] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState('');
  const [hostRequests, setHostRequests] = useState([]);
  const [reviewEligibility, setReviewEligibility] = useState(null);
  const [republishing, setRepublishing] = useState(false);
  const [lifecycleNotice, setLifecycleNotice] = useState('');
  const [clock, setClock] = useState(() => new Date());

  const loadDetail = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const found = await RideService.getRide(rideId);
      setRide(found);
      if (!found) return;
      if (found.hostId) RideReviewService.listProfileReviews(found.hostId).then(setReviews).catch(() => {});
      if (user && found.status === 'Completed') {
        setReviewEligibility(await RideReviewService.getEligibility(user.id, rideId).catch(() => null));
      } else {
        setReviewEligibility(null);
      }
      if (user && found.hostId === user.id) {
        const [requests, context] = await Promise.all([
          RideRequestService.listRideRequests(rideId).catch(() => []),
          RideService.getLifecycleContext(rideId).catch(() => null)
        ]);
        setHostRequests(requests);
        setActiveRequest(null);
        setLifecycleContext(context);
      } else if (user) {
        const requests = await RideRequestService.listMyRequests(user.id);
        const request = requests.find((item) => item.rideId === rideId && ['Pending', 'Accepted'].includes(item.status)) || requests.find((item) => item.rideId === rideId) || null;
        setActiveRequest(request);
        setHostRequests([]);
        setLifecycleContext(request?.status === 'Accepted' ? await RideService.getLifecycleContext(rideId).catch(() => null) : null);
      }
      setClock(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Unable to load this ride.');
    } finally { if (!silent) setLoading(false); }
  }, [rideId, user]);

  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [rideId]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isHost = Boolean(ride && ride.hostId === user?.id);
  const journeyState = useMemo(() => ride ? getRideJourneyState({
    ride, role: isHost ? 'driver' : 'passenger', request: activeRequest,
    requests: hostRequests, lifecycleContext, reviewEligibility, now: clock
  }) : null, [activeRequest, clock, hostRequests, isHost, lifecycleContext, reviewEligibility, ride]);
  const tripModeEligible = Boolean(user) && isTripModeEligible(journeyState);
  const showTripMode = tripModeEligible && searchParams.get('view') !== 'details';
  useEffect(() => {
    if (!showTripMode) return undefined;
    const refreshVisible = () => { if (document.visibilityState === 'visible') loadDetail({ silent: true }); };
    const interval = window.setInterval(refreshVisible, 15000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [loadDetail, showTripMode]);

  if (loading) return <div className="ride-page-loading">Loading ride…</div>;
  if (!ride) return <div className="ride-page-loading">This ride could not be found.</div>;

  const canEdit = isHost && ['Draft', 'Published'].includes(ride.status) && !ride.hasAcceptedRequests;
  const canCancel = isHost && ['Published', 'Matched'].includes(ride.status) && isBeforeRideExpiry(ride.departureAt, clock);
  const hasActiveRequest = ['Pending', 'Accepted'].includes(activeRequest?.status);
  const canResubmitRequest = activeRequest?.status !== 'Rejected';
  const canRequest = !isHost && ride.status === 'Published' && ride.seatsAvailable > 0 && isAtLeastHoursAway(ride.departureAt) && canResubmitRequest;
  const canMessageHost = !isHost && ride.status === 'Published';
  const canRepublish = isHost && ['Completed', 'Cancelled', 'Expired'].includes(ride.status);
  const requestDeadline = new Date(new Date(ride.departureAt).getTime() - REQUEST_CUTOFF_HOURS * 60 * 60 * 1000);
  const waypoints = ride.waypoints?.length ? ride.waypoints : [];
  const departureReached = new Date(ride.departureAt) <= clock;
  const returnTo = normaliseInternalReturnPath(location.state?.returnTo, user ? '/ride' : '/search');

  async function cancelRide(reason) {
    setError('');
    try {
      setRide(await RideService.cancelRide(ride.id, reason));
      setCancelling(false);
    } catch (err) { setError(err.message); }
  }

  async function submitRequest(payload) {
    setRequesting(true);
    setError('');
    try {
      const request = await RideRequestService.submitRequest(user.id, { rideId: ride.id, ...payload });
      setActiveRequest(request);
      setShowRequest(false);
    } catch (err) { setError(err.message); }
    finally { setRequesting(false); }
  }

  async function changeRecruitment(action) {
    setError('');
    try {
      setRide(action === 'close' ? await RideService.closeRecruitment(ride.id) : await RideService.reopenRecruitment(ride.id));
    } catch (err) { setError(err.message); }
  }

  async function republishRide() {
    if (!canRepublish || republishing) return;
    setRepublishing(true);
    setError('');
    try {
      const draft = await RideService.republishAsDraft(ride.id);
      navigate(`/ride/${draft.id}/publish`, { state: { republishedFromRideId: ride.id } });
    } catch (republishError) {
      setError(republishError.message || 'Unable to create a new draft from this ride.');
      setRepublishing(false);
    }
  }

  async function messageHost() {
    if (!user) {
      const target = getAuthNavigation(null, `/ride/${ride.id}`, 'Sign in before messaging this Host.');
      navigate(target.to, { state: target.state });
      return;
    }
    setError('');
    setIsOpeningChat(true);
    try {
      const conversationId = await MessagingService.openRideDirectConversation(ride.id);
      navigate(`/message/${conversationId}`);
    } catch (err) {
      setError(err.message || 'Unable to open a private chat with this Host.');
    } finally {
      setIsOpeningChat(false);
    }
  }

  async function openTripChat() {
    setError('');
    setIsOpeningChat(true);
    try {
      const conversations = await MessagingService.listConversations();
      const group = conversations.find((conversation) => conversation.rideId === ride.id && conversation.type === 'group');
      navigate(group ? `/message/${group.id}` : '/message');
    } catch (chatError) {
      setError(chatError.message || 'Unable to open the trip chat.');
    } finally { setIsOpeningChat(false); }
  }

  function openRequest() {
    if (!user) {
      const target = getAuthNavigation(null, `/ride/${ride.id}`, 'Sign in before requesting to join this ride.');
      navigate(target.to, { state: target.state });
      return;
    }
    setShowRequest(true);
  }

  async function runLifecycle(action, work) {
    setLifecycleBusy(action);
    setError('');
    setLifecycleNotice('');
    try {
      await work();
      await loadDetail({ silent: true });
      if (action === 'start') setLifecycleNotice('Trip started. The traffic-aware ETA has been updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLifecycleBusy('');
    }
  }

  if (showTripMode) {
    return <TripModeView
      ride={ride} journeyState={journeyState} isHost={isHost} userId={user?.id} activeRequest={activeRequest}
      hostRequests={hostRequests} lifecycleContext={lifecycleContext} lifecycleBusy={lifecycleBusy}
      notice={lifecycleNotice || location.state?.notice} error={error} clock={clock}
      onLifecycle={runLifecycle} onDetails={() => setSearchParams({ view: 'details' })}
      onBack={() => navigate(returnTo)} onManageRequests={() => navigate(`/ride/${ride.id}/requests`)}
      onTripChat={openTripChat}
    />;
  }

  return (
    <main className="phone-ride-page ride-detail-page">
      <div className="ride-detail-map-wrap">
        <RouteMap ride={ride} />
        <button className="map-back-button" onClick={() => navigate(returnTo)} aria-label="Go back"><IconArrowLeft size={18} /></button>
        <span className={`ride-status-badge ${statusClass(ride.status)}`}>{ride.status}</span>
        <a className="map-open-overlay" href={GoogleMapsEmbedService.buildGoogleMapsDirectionsUrl({ pickup: ride.pickup, pickupLocation: ride.pickupLocation, destination: ride.destination, destinationLocation: ride.destinationLocation, waypoints: ride.waypoints })} target="_blank" rel="noreferrer" aria-label="Open this route in Google Maps">Open map</a>
      </div>

      <div className="ride-detail-content">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {location.state?.notice && <div className="alert alert-success" role="status">{location.state.notice}</div>}
        {tripModeEligible && <section className="trip-mode-return-banner"><div><strong>Trip mode is ready</strong><span>{journeyState.title}</span></div><button type="button" className="btn-primary" onClick={() => setSearchParams({ view: 'trip' })}>Back to trip mode</button></section>}
        <section className="ride-info-card lifecycle-card"><Lifecycle status={ride.status} /></section>
        <section className="ride-info-card trip-info-mobile">
          <div className="trip-title-row"><h1>{ride.pickup?.split(',')[0]} <span>→</span> {ride.destination?.split(',')[0]}</h1><b className="scale-badge">{ride.journeyScale}</b></div>
          <div className="trip-detail-grid">
            <div><span><IconMapPin size={13} /> Pickup</span><strong>{ride.pickup}</strong></div>
            <div><span className="destination-icon"><IconMapPin size={13} /> Destination</span><strong>{ride.destination}</strong></div>
            <div><span><IconCalendar size={13} /> Date</span><strong>{formatDate(ride.date)}</strong></div>
            <div><span>◷ Time</span><strong>{formatTime(ride.time)}</strong></div>
          </div>
          <p className="ride-eta"><span>Estimated arrival</span><strong>{ride.estimatedArrivalAt ? formatDateTime(ride.estimatedArrivalAt) : 'Driver confirmation required'}</strong></p>
          <p className="seats-left"><IconUsers size={15} /> {ride.seatsAvailable} seat{ride.seatsAvailable === 1 ? '' : 's'} available</p>
          <p className="request-date">Request deadline: {requestDeadline.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })}</p>
        </section>

        <DestinationRidePhoto
          variant="detail"
          placeId={ride.destinationPhotoPlaceId || ride.destinationLocation?.placeId}
          label={ride.destination}
          maxWidth={1200}
        />

        {(ride.pickupInstructions || ride.hasPickupPhoto) && <section className="ride-info-card pickup-instructions-card"><p className="eyebrow">PICKUP INSTRUCTIONS</p>{ride.pickupInstructions && <p><IconMapPin size={15} /> {ride.pickupInstructions}</p>}{ride.hasPickupPhoto && <div className="pickup-photo-public"><PickupPhotoPreview rideId={ride.id} hasExisting /><small>Photo provided by the Driver to help identify the meeting point.</small></div>}</section>}

        <section className="fixed-route-note"><IconAlertTriangle size={16} /><span>This ride follows a <strong>fixed route</strong>. Route-deviation automation is not enabled yet.</span></section>

        {(isHost || activeRequest?.status === 'Accepted') && <section className="ride-info-card ride-verification-card">
          <p className="eyebrow">TRIP LIFECYCLE</p>
          <div className="verification-row"><span>Current step</span><strong>{journeyState.title}</strong></div>
          {activeRequest?.status === 'Accepted' && <div className="verification-row"><span>Passenger check-in</span><strong>{activeRequest.boardingStatus}</strong></div>}
          {lifecycleContext?.driverArrivedAt && <div className="verification-row"><span>Driver arrived</span><div className="verification-value"><strong><time dateTime={lifecycleContext.driverArrivedAt}>{formatDateTime(lifecycleContext.driverArrivedAt)}</time></strong>{lifecycleContext.passengerConfirmationDueAt && <small>Auto-completes by <time dateTime={lifecycleContext.passengerConfirmationDueAt}>{formatDateTime(lifecycleContext.passengerConfirmationDueAt)}</time> if confirmations remain.</small>}</div></div>}
          {activeRequest?.arrivalConfirmedAt && <div className="request-sent"><IconCheck size={15} /> Arrival confirmed</div>}
          {tripModeEligible && <button type="button" className="primary-action full" onClick={() => setSearchParams({ view: 'trip' })}>Open Trip Mode</button>}
        </section>}

        <section className="ride-info-card ride-preferences">
          <div><p className="eyebrow">RESTRICTIONS</p><div className="ride-tag-list">{ride.restrictionTags?.length ? ride.restrictionTags.map((tag) => <span key={tag}>{tag}</span>) : <small>No restrictions added</small>}</div></div>
          <div className="contribution"><p className="eyebrow">NON-MONETARY CONTRIBUTION</p><strong>🤝 {ride.contribution || 'No contribution needed'}</strong></div>
        </section>

        {waypoints.length > 0 && <section className="waypoints-section" aria-labelledby="ride-waypoints-heading">
          <div className="waypoints-heading">
            <span className="waypoints-heading-icon" aria-hidden="true"><IconMapPin size={20} /></span>
            <div>
              <p className="eyebrow">PLANNED STOPS</p>
              <h2 id="ride-waypoints-heading">Culinary &amp; cultural waypoints</h2>
            </div>
            <span className="waypoints-count">{waypoints.length} stop{waypoints.length === 1 ? '' : 's'}</span>
          </div>
          <div className="waypoint-scroller" aria-label="Planned route stops">
            {waypoints.map((waypoint, index) => <article className="waypoint-card" key={waypoint.placeId || waypoint.name}>
              <WaypointPhoto waypoint={waypoint} />
              <div className="waypoint-card-body">
                <div className="waypoint-card-meta">
                  <span>Stop {index + 1}</span>
                  <span className="waypoint-duration"><IconClock size={14} aria-hidden="true" /> {waypoint.stopMinutes || 0} min</span>
                </div>
                <h3>{waypoint.name}</h3>
                {waypoint.description && <p>{waypoint.description}</p>}
              </div>
            </article>)}
          </div>
        </section>}
        <HostIdentity ride={ride} />
        <section className="ride-info-card"><p className="eyebrow">HOST REVIEWS</p>{reviews.length ? reviews.slice(0, 3).map((review) => <div className="review-row" key={review.id}><span>{review.reviewer?.fullName || 'Member'} · {review.rating}/5</span><strong>{review.comment || 'No written comment'}</strong></div>) : <p className="empty-waypoints">No reviews yet</p>}</section>
      </div>

      <div className="ride-bottom-actions" aria-label="Ride actions">
        {isHost ? <>
          {ride.status === 'Draft' ? <button className="primary-action full" onClick={() => navigate(`/ride/${ride.id}/publish`)}><IconEdit size={15} /> Continue draft</button> : (canEdit || (!departureReached && ['Published', 'Matched'].includes(ride.status))) && <div className="host-action-row">
            {canEdit && <button className="outline-action" onClick={() => navigate(`/ride/${ride.id}/edit`)}><IconEdit size={15} /> Edit ride</button>}
            {!departureReached && ['Published', 'Matched'].includes(ride.status) && <button className="primary-action" onClick={() => navigate(`/ride/${ride.id}/requests`)}><IconUsers size={15} /> Manage requests</button>}
          </div>}
          {ride.status === 'Published' && !departureReached && hostRequests.some((request) => request.status === 'Accepted') && <button className="outline-action full" onClick={() => changeRecruitment('close')}>Close recruitment</button>}
          {ride.status === 'Matched' && isAtLeastHoursAway(ride.departureAt) && <button className="outline-action full" onClick={() => changeRecruitment('reopen')}>Reopen recruitment</button>}
          {ride.status === 'Completed' && <button className="primary-action full" onClick={() => navigate(journeyState.nextAction.path || `/ride/${ride.id}`)}>{journeyState.nextAction.label}</button>}
          {canRepublish && <Button className="ride-detail-republish" variant="secondary" loading={republishing} loadingLabel="Creating draft" onClick={republishRide}><IconPlus size={15} aria-hidden="true" /> Publish again</Button>}
          {canCancel && <button className="cancel-action" onClick={() => setCancelling(true)}>Cancel this ride</button>}
        </> : <>
          {canMessageHost && <button className="outline-action full" disabled={isOpeningChat} onClick={messageHost}><IconMessage size={15} /> {isOpeningChat ? 'Opening chat…' : 'Message host'}</button>}
          {ride.status === 'Completed' ? <button className="primary-action full" onClick={() => navigate(journeyState.nextAction.path || `/ride/${ride.id}`)}>{journeyState.nextAction.label}</button>
            : activeRequest?.status === 'Accepted' ? <div className="request-sent"><IconCheck size={15} /> Request accepted</div>
              : activeRequest?.status === 'Pending' ? <div className="request-sent"><IconCheck size={15} /> Request sent — awaiting Host approval</div>
                : activeRequest?.status === 'Cancelled' ? <div className="request-status-message request-cancelled-message"><IconX size={15} /> Request cancelled — no Driver approval needed</div>
                  : activeRequest?.status === 'Rejected' ? <div className="request-status-message"><IconX size={15} /> Request rejected. This ride request cannot be resubmitted.</div>
                  : activeRequest ? <div className="request-status-message"><IconX size={15} /> Request {activeRequest.status.toLowerCase()}. You can submit a new request while this ride is open.</div>
                    : null}
          {ride.status !== 'Completed' && !hasActiveRequest && canResubmitRequest && <button className="primary-action full" disabled={!canRequest} onClick={openRequest}>{canRequest ? 'Request to join' : 'Requests are closed'}</button>}
        </>}
      </div>
      {cancelling && <CancelSheet onDismiss={() => setCancelling(false)} onConfirm={cancelRide} />}
      {showRequest && <RequestSheet ride={ride} onDismiss={() => { setShowRequest(false); setError(''); }} onSubmit={submitRequest} saving={requesting} error={error} />}
    </main>
  );
}

function formatDate(value) {
  if (!value) return 'Date to be confirmed';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(value) {
  if (!value) return 'Time to be confirmed';
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
}
