import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getAuthNavigation, normaliseInternalReturnPath } from '../../../business-logic/authAccess.js';
import { RideService } from '../../../business-logic/RideService.js';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import { RideReviewService } from '../../../business-logic/RideReviewService.js';
import { isAtLeastHoursAway, REQUEST_CUTOFF_HOURS } from '../../../business-logic/rideDateTime.js';
import { GoogleMapsEmbedService } from '../../../business-logic/GoogleMapsEmbedService.js';
import { MessagingService } from '../../../business-logic/MessagingService.js';
import { formatJourneyCountdown, getRideJourneyState, isTripModeEligible, RIDE_ACTION } from '../../../business-logic/rideJourneyState.js';
import GoogleRouteMap from '../maps/GoogleRouteMap.jsx';
import {
  IconAlertTriangle, IconArrowLeft, IconCalendar, IconCheck, IconEdit,
  IconMapPin, IconMessage, IconRoute, IconStar, IconUsers, IconX
} from '../icons.jsx';
import '../../styles/ride.css';

const LIFECYCLE = ['Draft', 'Published', 'Matched', 'In Transit', 'Completed'];

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

function TripModeView({
  ride, journeyState, isHost, activeRequest, hostRequests, lifecycleContext,
  lifecycleBusy, notice, error, onLifecycle, onDetails, onBack, onManageRequests, onTripChat
}) {
  const accepted = hostRequests.filter((request) => request.status === 'Accepted');
  const pending = hostRequests.filter((request) => request.status === 'Pending');
  const departureReached = new Date(ride.departureAt) <= new Date();
  const mapsUrl = GoogleMapsEmbedService.buildGoogleMapsDirectionsUrl({ pickup: ride.pickup, pickupLocation: ride.pickupLocation, destination: ride.destination, destinationLocation: ride.destinationLocation, waypoints: ride.waypoints });
  const checkedInCount = accepted.filter((request) => request.boardingStatus === 'Checked In').length;
  const unresolvedCount = accepted.filter((request) => request.boardingStatus === 'Pending').length;

  return <main className="phone-ride-page ride-detail-page trip-mode-page">
    <header className="trip-mode-header"><button className="round-icon-button" type="button" onClick={onBack} aria-label="Go back"><IconArrowLeft size={18} /></button><div><p className="eyebrow">TRIP MODE · {isHost ? 'DRIVER' : 'PASSENGER'}</p><h1>{ride.pickup?.split(',')[0]} → {ride.destination?.split(',')[0]}</h1></div><button type="button" className="btn-link" onClick={onDetails}>View ride details</button></header>
    <div className="trip-mode-content">
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      <section className={`trip-command-card urgency-${journeyState.urgency}`} aria-live="polite"><span className={`ride-status-badge ${statusClass(ride.status)}`}>{ride.status}</span><h2>{journeyState.title}</h2><p>{journeyState.description}</p>{journeyState.countdownAt && <strong className="trip-countdown">{formatJourneyCountdown(journeyState.countdownAt)}</strong>}{journeyState.blockers.map((blocker) => <small key={blocker}>{blocker}</small>)}</section>
      <section className="trip-route-card"><RouteMap ride={ride} /><div><p><strong>{ride.pickup}</strong><span>Pickup</span></p><p><strong>{ride.destination}</strong><span>Destination</span></p>{ride.status === 'In Transit' && ride.estimatedArrivalAt && <p><strong>{formatDateTime(ride.estimatedArrivalAt)}</strong><span>Updated traffic ETA</span></p>}</div></section>
      {ride.pickupInstructions && <section className="ride-info-card pickup-instructions-card"><p className="eyebrow">PICKUP INSTRUCTIONS</p><p><IconMapPin size={15} /> {ride.pickupInstructions}</p></section>}

      {isHost && <section className="ride-info-card trip-readiness-card"><div className="trip-section-heading"><div><p className="eyebrow">PASSENGER READINESS</p><h2>{checkedInCount} of {accepted.length} checked in</h2></div>{pending.length > 0 && <button type="button" className="btn-link" onClick={onManageRequests}>{pending.length} pending request{pending.length === 1 ? '' : 's'}</button>}</div>{accepted.length ? <div className="trip-passenger-list">{accepted.map((request) => <div key={request.id}><span><strong>{request.requester?.fullName || 'Passenger'}</strong><small>{request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'}</small></span><b className={`boarding-state boarding-${request.boardingStatus.toLowerCase().replaceAll(' ', '-')}`}>{request.boardingStatus}</b>{request.boardingStatus === 'Pending' && departureReached && <button type="button" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle(`no-show-${request.id}`, () => RideRequestService.markNoShow(request.id))}>{lifecycleBusy === `no-show-${request.id}` ? 'Working…' : 'Mark No-show'}</button>}</div>)}</div> : <p>No accepted passengers yet.</p>}</section>}

      {!isHost && activeRequest && <section className="ride-info-card trip-passenger-status"><p className="eyebrow">YOUR BOARDING STATUS</p><h2>{activeRequest.boardingStatus}</h2>{activeRequest.checkedInAt && <p>Checked in {formatDateTime(activeRequest.checkedInAt)}</p>}{activeRequest.checkInDistanceMeters != null && <small>{activeRequest.checkInDistanceMeters} m from pickup</small>}</section>}

      <section className="trip-mode-actions" aria-label="Trip actions">
        {!isHost && journeyState.nextAction.id === RIDE_ACTION.CHECK_IN && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('check-in', () => RideRequestService.checkIn(activeRequest.id))}>{lifecycleBusy === 'check-in' ? 'Checking GPS…' : 'Check in near pickup'}</button>}
        {isHost && journeyState.nextAction.id === RIDE_ACTION.START_RIDE && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('start', () => RideService.startRide(ride.id))}>{lifecycleBusy === 'start' ? 'Recalculating ETA…' : journeyState.nextAction.label}</button>}
        {isHost && ride.status === 'In Transit' && !lifecycleContext?.driverArrivedAt && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('driver-arrival', () => RideService.confirmDriverArrival(ride.id))}>{lifecycleBusy === 'driver-arrival' ? 'Checking GPS…' : 'Confirm destination arrival'}</button>}
        {!isHost && journeyState.nextAction.id === RIDE_ACTION.CONFIRM_PASSENGER_ARRIVAL && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => onLifecycle('passenger-arrival', () => RideRequestService.confirmArrival(activeRequest.id))}>{lifecycleBusy === 'passenger-arrival' ? 'Confirming…' : 'Confirm I arrived'}</button>}
        {isHost && departureReached && unresolvedCount > 0 && journeyState.nextAction.id !== RIDE_ACTION.START_RIDE && <button type="button" className="btn-secondary full" onClick={onManageRequests}>Resolve all passengers</button>}
        <a className="outline-action full" href={mapsUrl} target="_blank" rel="noreferrer"><IconRoute size={16} /> Open in Google Maps</a>
        <button type="button" className="outline-action full" onClick={onTripChat}><IconMessage size={16} /> Open trip chat</button>
      </section>
    </div>
  </main>;
}

function CancelSheet({ onDismiss, onConfirm }) {
  const [reason, setReason] = useState('');
  const reasons = ['Change of plans', 'Vehicle issue', 'Emergency', 'Other'];
  return (
    <div className="sheet-backdrop" onMouseDown={onDismiss}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-ride-title" onKeyDown={(event) => event.key === 'Escape' && onDismiss()} onMouseDown={(event) => event.stopPropagation()}>
        <span className="sheet-handle" />
        <div className="sheet-title-row"><h2 id="cancel-ride-title">Cancel this ride?</h2><button type="button" autoFocus onClick={onDismiss} aria-label="Close cancellation dialog"><IconX size={19} /></button></div>
        <p>Let passengers know why this ride is no longer available.</p>
        <div className="reason-list">
          {reasons.map((item) => <button type="button" aria-pressed={reason === item} className={reason === item ? 'selected' : ''} key={item} onClick={() => setReason(item)}><i />{item}</button>)}
        </div>
        <button type="button" className="danger-button" disabled={!reason} onClick={() => onConfirm(reason)}>Confirm cancellation</button>
      </section>
    </div>
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
    <div className="sheet-backdrop" onMouseDown={onDismiss}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="request-ride-title" onKeyDown={(event) => event.key === 'Escape' && onDismiss()} onMouseDown={(event) => event.stopPropagation()}>
        <span className="sheet-handle" />
        <div className="sheet-title-row"><h2 id="request-ride-title">Request to join</h2><button type="button" autoFocus onClick={onDismiss} aria-label="Close request dialog"><IconX size={19} /></button></div>
        <p>Seats include you. Pending requests do not reserve seats until the Host accepts them.</p>
        <div className="field"><label>Seats requested</label><div className="seat-stepper" aria-label="Seats requested"><button type="button" aria-label="Decrease requested seats" onClick={() => setSeats(seatsRequested - 1)}>−</button><output aria-live="polite">{seatsRequested}</output><button type="button" aria-label="Increase requested seats" onClick={() => setSeats(seatsRequested + 1)}>+</button></div></div>
        {companionNames.map((name, index) => <div className="field" key={index}><label htmlFor={`companion-${index}`}>Companion {index + 1} name</label><input id={`companion-${index}`} value={name} onChange={(event) => setCompanionNames((names) => names.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></div>)}
        {error && <div className="alert alert-error sheet-error" role="alert">{error}</div>}
        <button className="primary-action full" disabled={saving || companionNames.some((name) => !name.trim())} onClick={() => onSubmit({ seatsRequested, companionNames })}>{saving ? 'Sending…' : `Request ${seatsRequested} seat${seatsRequested === 1 ? '' : 's'}`}</button>
      </section>
    </div>
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
    const timer = window.setInterval(() => setClock(new Date()), 30000);
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
  const canCancel = isHost && ['Published', 'Matched'].includes(ride.status);
  const hasActiveRequest = ['Pending', 'Accepted'].includes(activeRequest?.status);
  const canResubmitRequest = activeRequest?.status !== 'Rejected';
  const canRequest = !isHost && ride.status === 'Published' && ride.seatsAvailable > 0 && isAtLeastHoursAway(ride.departureAt) && canResubmitRequest;
  const canMessageHost = !isHost && ride.status === 'Published';
  const requestDeadline = new Date(new Date(ride.departureAt).getTime() - REQUEST_CUTOFF_HOURS * 60 * 60 * 1000);
  const waypoints = ride.waypoints?.length ? ride.waypoints : [];
  const departureReached = new Date(ride.departureAt) <= new Date();
  const checkInOpen = new Date(ride.departureAt).getTime() - Date.now() <= REQUEST_CUTOFF_HOURS * 60 * 60 * 1000;
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
      ride={ride} journeyState={journeyState} isHost={isHost} activeRequest={activeRequest}
      hostRequests={hostRequests} lifecycleContext={lifecycleContext} lifecycleBusy={lifecycleBusy}
      notice={lifecycleNotice || location.state?.notice} error={error}
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

        {ride.pickupInstructions && <section className="ride-info-card pickup-instructions-card"><p className="eyebrow">PICKUP INSTRUCTIONS</p><p><IconMapPin size={15} /> {ride.pickupInstructions}</p></section>}

        <section className="fixed-route-note"><IconAlertTriangle size={16} /><span>This ride follows a <strong>fixed route</strong>. Route-deviation automation is not enabled yet.</span></section>

        {(isHost || activeRequest?.status === 'Accepted') && <section className="ride-info-card ride-verification-card">
          <p className="eyebrow">TRIP VERIFICATION</p>
          {activeRequest?.status === 'Accepted' && ['Published', 'Matched', 'In Transit'].includes(ride.status) && <div className="verification-row"><span>Passenger check-in</span><strong>{activeRequest.boardingStatus}</strong>{activeRequest.boardingStatus === 'Pending' && ['Published', 'Matched'].includes(ride.status) && <button type="button" disabled={!checkInOpen || Boolean(lifecycleBusy)} onClick={() => runLifecycle('check-in', () => RideRequestService.checkIn(activeRequest.id))}>{lifecycleBusy === 'check-in' ? 'Checking GPS…' : checkInOpen ? 'Check in near pickup' : 'Opens 1 hour before'}</button>}</div>}
        {isHost && ['Published', 'Matched'].includes(ride.status) && <div className="verification-row"><span>Departure</span><strong>{journeyState.nextAction.id === RIDE_ACTION.START_RIDE ? journeyState.description : 'All accepted passengers must Check in before the Driver can start early.'}</strong><button type="button" disabled={journeyState.nextAction.id !== RIDE_ACTION.START_RIDE || Boolean(lifecycleBusy)} onClick={() => runLifecycle('start', () => RideService.startRide(ride.id))}>{lifecycleBusy === 'start' ? 'Recalculating ETA…' : journeyState.nextAction.id === RIDE_ACTION.START_RIDE ? journeyState.nextAction.label : 'Waiting for all check-ins'}</button></div>}
          {isHost && ride.status === 'In Transit' && !lifecycleContext?.driverArrivedAt && <div className="verification-row"><span>Destination</span><strong>GPS must be within 200 m with accuracy ≤100 m.</strong><button type="button" disabled={Boolean(lifecycleBusy)} onClick={() => runLifecycle('driver-arrival', () => RideService.confirmDriverArrival(ride.id))}>{lifecycleBusy === 'driver-arrival' ? 'Checking GPS…' : 'Confirm destination arrival'}</button></div>}
          {lifecycleContext?.driverArrivedAt && <div className="verification-row"><span>Driver arrived</span><strong>{formatDateTime(lifecycleContext.driverArrivedAt)}</strong>{lifecycleContext.passengerConfirmationDueAt && <small>Auto-completes by {formatDateTime(lifecycleContext.passengerConfirmationDueAt)} if confirmations remain.</small>}</div>}
          {activeRequest?.boardingStatus === 'Checked In' && ride.status === 'In Transit' && lifecycleContext?.driverArrivedAt && !activeRequest.arrivalConfirmedAt && <button type="button" className="primary-action full" disabled={Boolean(lifecycleBusy)} onClick={() => runLifecycle('passenger-arrival', () => RideRequestService.confirmArrival(activeRequest.id))}>{lifecycleBusy === 'passenger-arrival' ? 'Confirming…' : 'Confirm I arrived'}</button>}
          {activeRequest?.arrivalConfirmedAt && <div className="request-sent"><IconCheck size={15} /> Arrival confirmed</div>}
        </section>}

        <section className="ride-info-card ride-preferences">
          <div><p className="eyebrow">RESTRICTIONS</p><div className="ride-tag-list">{ride.restrictionTags?.length ? ride.restrictionTags.map((tag) => <span key={tag}>{tag}</span>) : <small>No restrictions added</small>}</div></div>
          <div className="contribution"><p className="eyebrow">NON-MONETARY CONTRIBUTION</p><strong>🤝 {ride.contribution || 'No contribution needed'}</strong></div>
        </section>

        {waypoints.length > 0 && <section className="waypoints-section"><h2>🗺️ Culinary & cultural waypoints</h2><div className="waypoint-scroller">{waypoints.map((waypoint) => <article key={waypoint.placeId || waypoint.name}><div className="waypoint-art">✦</div><strong>{waypoint.name}</strong><p>{waypoint.description || `${waypoint.stopMinutes || 0} minute stop`}</p></article>)}</div></section>}
        <HostIdentity ride={ride} />
        <section className="ride-info-card"><p className="eyebrow">HOST REVIEWS</p>{reviews.length ? reviews.slice(0, 3).map((review) => <div className="review-row" key={review.id}><span>{review.reviewer?.fullName || 'Member'} · {review.rating}/5</span><strong>{review.comment || 'No written comment'}</strong></div>) : <p className="empty-waypoints">No reviews yet</p>}</section>
      </div>

      <div className="ride-bottom-actions" aria-label="Ride actions">
        {isHost ? <>
          {ride.status === 'Draft' ? <button className="primary-action full" onClick={() => navigate(`/ride/${ride.id}/publish`)}><IconEdit size={15} /> Continue draft</button> : <div className="host-action-row">
            {canEdit && <button className="outline-action" onClick={() => navigate(`/ride/${ride.id}/edit`)}><IconEdit size={15} /> Edit ride</button>}
            {['Published', 'Matched'].includes(ride.status) && <button className="primary-action" onClick={() => navigate(`/ride/${ride.id}/requests`)}><IconUsers size={15} /> Manage requests</button>}
          </div>}
          {ride.status === 'Published' && <button className="outline-action full" onClick={() => changeRecruitment('close')}>Close recruitment</button>}
          {ride.status === 'Matched' && isAtLeastHoursAway(ride.departureAt) && <button className="outline-action full" onClick={() => changeRecruitment('reopen')}>Reopen recruitment</button>}
          {ride.status === 'Completed' && <button className="primary-action full" onClick={() => navigate(journeyState.nextAction.path || `/ride/${ride.id}`)}>{journeyState.nextAction.label}</button>}
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
