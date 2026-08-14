import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RideService } from '../../../business-logic/RideService.js';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import { IconArrowLeft, IconCheck, IconStar, IconUsers } from '../icons.jsx';
import '../../styles/ride.css';

function avatar(name = 'Member') {
  return name.split(' ').map((word) => word[0]).slice(0, 2).join('');
}

function tier(score = 0) {
  return score >= 80 ? 'Gold' : score >= 60 ? 'Silver' : 'Bronze';
}

export default function ManageRequests() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [nextRide, nextRequests] = await Promise.all([
        RideService.getRide(rideId),
        RideRequestService.listRideRequests(rideId)
      ]);
      setRide(nextRide);
      setRequests(nextRequests);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [rideId]);

  useEffect(() => { load(); }, [load]);

  async function decide(request, decision) {
    setBusyId(request.id);
    setError('');
    try {
      if (decision === 'Accepted') await RideRequestService.acceptRequest(request.id);
      else await RideRequestService.rejectRequest(request.id);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  }

  async function markNoShow(request) {
    setBusyId(request.id);
    setError('');
    try {
      await RideRequestService.markNoShow(request.id);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  }

  if (loading) return <div className="ride-page-loading">Loading requests…</div>;

  const pending = requests.filter((request) => request.status === 'Pending');
  const accepted = requests.filter((request) => request.status === 'Accepted');
  const history = requests.filter((request) => !['Pending', 'Accepted'].includes(request.status));
  const departureReached = ride && new Date(ride.departureAt) <= new Date();

  function RequestCard({ request, actions = false, muted = false }) {
    const person = request.requester || { fullName: 'Member', reputationScore: 0, rating: null };
    return (
      <article className={`passenger-request-card ${muted ? 'muted' : ''}`} aria-busy={busyId === request.id}>
        <span className="request-avatar">{avatar(person.fullName)}</span>
        <div className="request-person">
          <strong>{person.fullName} · {request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'}</strong>
          <span><IconStar size={11} /> {person.rating == null ? 'New' : Number(person.rating).toFixed(1)} <b className="tier-badge">{tier(person.reputationScore)}</b> <small>{request.status}</small></span>
          {request.companionNames.length > 0 && <small>Companions: {request.companionNames.join(', ')}</small>}
          {request.decisionReason && <small>Reason: {request.decisionReason}</small>}
          {request.status === 'Accepted' && <small className={`boarding-state boarding-${request.boardingStatus.toLowerCase().replaceAll(' ', '-')}`}>Boarding: {request.boardingStatus}{request.checkInDistanceMeters != null ? ` · ${request.checkInDistanceMeters} m from pickup` : ''}</small>}
        </div>
        {actions && <div className="request-actions"><button type="button" disabled={busyId === request.id} onClick={() => decide(request, 'Rejected')}>{busyId === request.id ? 'Working…' : 'Reject'}</button><button type="button" disabled={busyId === request.id || request.seatsRequested > (ride?.seatsAvailable ?? 0)} onClick={() => decide(request, 'Accepted')}>{busyId === request.id ? 'Working…' : 'Accept'}</button></div>}
        {request.status === 'Accepted' && request.boardingStatus === 'Pending' && <div className="request-actions no-show-action"><button type="button" disabled={!departureReached || busyId === request.id} onClick={() => markNoShow(request)}>{busyId === request.id ? 'Working…' : departureReached ? 'Mark No-show' : 'No-show at departure'}</button></div>}
      </article>
    );
  }

  return (
    <main className="phone-ride-page requests-page">
      <header className="mobile-page-header request-header">
        <button className="round-icon-button" onClick={() => navigate(`/ride/${rideId}`)} aria-label="Go back"><IconArrowLeft size={18} /></button>
        <div><h1>Manage requests</h1><p>{ride ? `${ride.pickup.split(',')[0]} → ${ride.destination.split(',')[0]}` : 'Your ride'}</p></div>
      </header>
      <div className="requests-page-content">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <section className="request-stats" aria-label="Request summary">
          <div><strong>{pending.length}</strong><span>Pending</span></div>
          <div><strong>{accepted.reduce((sum, request) => sum + request.seatsRequested, 0)}</strong><span>Accepted seats</span></div>
          <div><strong>{ride?.seatsAvailable ?? 0}</strong><span>Seats left</span></div>
        </section>

        {accepted.length > 0 && <section className="request-group"><h2 className="accepted-heading"><IconCheck size={13} /> Accepted ({accepted.length})</h2>{accepted.map((request) => <RequestCard request={request} key={request.id} />)}</section>}
        {pending.length > 0 ? <section className="request-group"><h2 className="pending-heading">Pending ({pending.length})</h2>{pending.map((request) => <RequestCard request={request} actions key={request.id} />)}</section>
          : <section className="empty-request-state"><IconUsers size={34} /><strong>No pending requests</strong><p>New passenger requests will appear here.</p></section>}

        {history.length > 0 && <section className="request-group rejected-group"><button type="button" className="rejected-toggle" aria-expanded={showHistory} onClick={() => setShowHistory((show) => !show)}>History ({history.length})</button>{showHistory && history.map((request) => <RequestCard request={request} muted key={request.id} />)}</section>}
      </div>
    </main>
  );
}
