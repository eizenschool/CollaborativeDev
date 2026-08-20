import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import { IconArrowLeft, IconCalendar, IconMapPin, IconX } from '../icons.jsx';
import '../../styles/ride.css';

const reasons = ['Change of plans', 'Found another ride', 'Emergency', 'Scheduling conflict', 'Other'];

function RequestStatus({ status }) {
  return <span className={`request-status request-${status.toLowerCase()}`}>{status}</span>;
}

export default function MyRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    try { setRequests(await RideRequestService.listMyRequests(user.id)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function cancel() {
    const finalReason = reason === 'Other' ? otherReason.trim() : reason;
    if (!finalReason) return;
    setError('');
    try {
      await RideRequestService.cancelRequest(cancelling.id, finalReason);
      setCancelling(null);
      setReason('');
      setOtherReason('');
      await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <main className="phone-ride-page my-requests-page">
      <header className="mobile-page-header"><button className="round-icon-button" onClick={() => navigate('/ride')} aria-label="Go back"><IconArrowLeft size={18} /></button><h1>My ride requests</h1></header>
      <div className="my-requests-content">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {loading ? <div className="ride-page-loading compact" role="status">Loading requests…</div> : requests.length ? requests.map((request) => {
          const ride = request.ride;
          return <article className="my-request-row" key={request.id}>
            <button className="my-request-main" disabled={!ride} onClick={() => ride && navigate(`/ride/${ride.id}`)}>
              <span className="route-row"><IconMapPin size={13} /> <strong>{ride ? `${ride.pickup.split(',')[0]} → ${ride.destination.split(',')[0]}` : 'Ride details unavailable'}</strong></span>
              <span className="request-date"><IconCalendar size={12} /> {ride ? `${ride.date} · ${ride.time}` : request.createdAt}</span>
              {ride?.estimatedArrivalAt && <span className="request-date">ETA {new Date(ride.estimatedArrivalAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })}</span>}
              <span className="request-date">{request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'}{request.companionNames.length ? ` · ${request.companionNames.join(', ')}` : ''}</span>
              {request.status === 'Accepted' && <span className="request-date">Boarding: {request.boardingStatus}</span>}
              {request.decisionReason && <span className="request-date">Reason: {request.decisionReason}</span>}
            </button>
            <div className="request-row-footer"><span>Host: <strong>{ride?.host?.fullName || 'Let’s Tumpang Host'}</strong></span><RequestStatus status={request.status} />{['Pending', 'Accepted'].includes(request.status) && <button onClick={() => setCancelling(request)}>Cancel</button>}</div>
          </article>;
        }) : <section className="empty-request-state"><span className="empty-car">🚗</span><strong>No requests yet</strong><p>Find a ride and submit your first request.</p><button className="primary-action" onClick={() => navigate('/ride')}>Find rides</button></section>}
      </div>
      {cancelling && <div className="sheet-backdrop" onMouseDown={() => setCancelling(null)}><section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-request-title" onKeyDown={(event) => event.key === 'Escape' && setCancelling(null)} onMouseDown={(event) => event.stopPropagation()}><span className="sheet-handle" /><div className="sheet-title-row"><h2 id="cancel-request-title">Cancel request</h2><button type="button" autoFocus aria-label="Close cancellation dialog" onClick={() => setCancelling(null)}><IconX size={19} /></button></div><p>Why are you cancelling this request?</p><div className="reason-list">{reasons.map((item) => <button type="button" aria-pressed={reason === item} key={item} className={reason === item ? 'selected' : ''} onClick={() => setReason(item)}><i />{item}</button>)}</div>{reason === 'Other' && <textarea aria-label="Cancellation reason" value={otherReason} onChange={(event) => setOtherReason(event.target.value)} placeholder="Describe your reason…" />}<button type="button" className="danger-button" disabled={!reason || (reason === 'Other' && !otherReason.trim())} onClick={cancel}>Confirm cancellation</button></section></div>}
    </main>
  );
}
