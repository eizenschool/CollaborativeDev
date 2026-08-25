import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import { RideReviewService } from '../../../business-logic/RideReviewService.js';
import { compareJourneyStates, formatJourneyCountdown, getRideJourneyState, isTripModeEligible } from '../../../business-logic/rideJourneyState.js';
import { IconArrowLeft, IconCalendar, IconMapPin } from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import '../../styles/ride.css';

const reasons = ['Change of plans', 'Found another ride', 'Emergency', 'Scheduling conflict', 'Other'];

function RequestStatus({ status }) {
  return <span className={`request-status request-${status.toLowerCase()}`}>{status}</span>;
}

export default function MyRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [reviewsByRide, setReviewsByRide] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [clock, setClock] = useState(() => new Date());

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const nextRequests = await RideRequestService.listMyRequests(user.id);
      const completedIds = [...new Set(nextRequests.filter((request) => request.ride?.status === 'Completed').map((request) => request.ride.id))];
      const reviewPairs = await Promise.all(completedIds.map(async (rideId) => {
        try { return [rideId, await RideReviewService.getEligibility(user.id, rideId)]; }
        catch { return [rideId, null]; }
      }));
      setRequests(nextRequests);
      setReviewsByRide(Object.fromEntries(reviewPairs));
    }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refreshVisible = () => {
      setClock(new Date());
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [load]);
  const journeyRequests = useMemo(() => requests.map((request) => ({
    request, ride: request.ride,
    state: request.ride ? getRideJourneyState({ ride: request.ride, role: 'passenger', request, reviewEligibility: reviewsByRide[request.ride.id] ?? null, now: clock }) : null
  })).sort((left, right) => {
    if (!left.state) return 1;
    if (!right.state) return -1;
    return compareJourneyStates(left, right);
  }), [clock, requests, reviewsByRide]);

  async function cancel() {
    const finalReason = reason === 'Other' ? otherReason.trim() : reason;
    if (!finalReason) return;
    if (!cancelling?.ride || new Date(cancelling.ride.departureAt) <= new Date()) {
      setError('Requests can only be cancelled before departure.');
      setCancelling(null);
      return;
    }
    setError('');
    setNotice('');
    try {
      await RideRequestService.cancelRequest(cancelling.id, finalReason);
      setCancelling(null);
      setReason('');
      setOtherReason('');
      setNotice('Request cancelled immediately. The Driver does not need to approve this cancellation.');
      await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <main className="phone-ride-page my-requests-page">
      <header className="mobile-page-header"><button className="round-icon-button" onClick={() => navigate('/ride')} aria-label="Go back"><IconArrowLeft size={18} /></button><h1>My ride requests</h1></header>
      <div className="my-requests-content">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {notice && <div className="alert alert-success" role="status">{notice}</div>}
        {loading ? <div className="ride-page-loading compact" role="status">Loading requests…</div> : journeyRequests.length ? journeyRequests.map(({ request, ride, state }) => {
          return <article className="my-request-row" key={request.id}>
            <button className="my-request-main" disabled={!ride} onClick={() => ride && navigate(`/ride/${ride.id}${isTripModeEligible(state) ? '?view=trip' : ''}`, { state: { returnTo: '/ride/requests' } })}>
              <span className="route-row"><IconMapPin size={13} /> <strong>{ride ? `${ride.pickup.split(',')[0]} → ${ride.destination.split(',')[0]}` : 'Ride details unavailable'}</strong></span>
              <span className="request-date"><IconCalendar size={12} /> {ride ? `${ride.date} · ${ride.time}` : request.createdAt}</span>
              {ride?.estimatedArrivalAt && <span className="request-date">ETA {new Date(ride.estimatedArrivalAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })}</span>}
              <span className="request-date">{request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'}{request.companionNames.length ? ` · ${request.companionNames.join(', ')}` : ''}</span>
              {request.status === 'Accepted' && <span className="request-date">Boarding: {request.boardingStatus}</span>}
              {state && <span className={`request-next-action urgency-${state.urgency}`}><strong>{state.title}</strong> · {state.nextAction.label}</span>}
              {state?.countdownAt && <span className="request-date">{formatJourneyCountdown(state.countdownAt, clock, state.countdownKind)}</span>}
              {request.decisionReason && <span className="request-date">Reason: {request.decisionReason}</span>}
            </button>
            <div className="request-row-footer"><span>Host: <strong>{ride?.host?.fullName || 'Let’s Tumpang Host'}</strong></span><RequestStatus status={request.status} />{ride && new Date(ride.departureAt) > clock && ['Pending', 'Accepted'].includes(request.status) && <button onClick={() => { setCancelling(request); setReason(''); setOtherReason(''); }}>Cancel</button>}</div>
          </article>;
        }) : <section className="empty-request-state"><span className="empty-car">🚗</span><strong>No requests yet</strong><p>Find a ride and submit your first request.</p><button className="primary-action" onClick={() => navigate('/search')}>Find rides</button></section>}
      </div>
      <AdaptiveDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel this request?"
        description="Cancellation takes effect immediately. The Driver will be notified and does not need to approve it."
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>Keep request</Button>
            <Button variant="danger" disabled={!reason || (reason === 'Other' && !otherReason.trim())} onClick={cancel}>Confirm cancellation</Button>
          </>
        )}
      >
        <div className="reason-list" role="group" aria-label="Cancellation reason">{reasons.map((item) => <button type="button" aria-pressed={reason === item} key={item} className={reason === item ? 'selected' : ''} onClick={() => setReason(item)}><i aria-hidden="true" />{item}</button>)}</div>
        {reason === 'Other' && <textarea className="request-cancellation-reason" aria-label="Cancellation reason" value={otherReason} onChange={(event) => setOtherReason(event.target.value)} placeholder="Describe your reason…" />}
      </AdaptiveDialog>
    </main>
  );
}
