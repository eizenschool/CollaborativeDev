import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RideService } from '../../../business-logic/RideService.js';
import { IconArrowLeft, IconCalendar, IconMapPin, IconX } from '../icons.jsx';
import '../../styles/ride.css';

const reasons = ['Change of plans', 'Found another ride', 'Emergency', 'Scheduling conflict', 'Other'];

function RequestStatus({ status }) {
  return <span className={`request-status request-${status.toLowerCase()}`}>{status}</span>;
}

export default function MyRequests() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    RideService.searchRides({}).then((rides) => setRequests(rides.slice(0, 2).map((ride, index) => ({ ride, status: index ? 'Accepted' : 'Pending' }))));
  }, []);

  function cancel() {
    setRequests((current) => current.filter((request) => request.ride.id !== cancelling.ride.id));
    setCancelling(null);
    setReason('');
  }

  return (
    <main className="phone-ride-page my-requests-page">
      <header className="mobile-page-header"><button className="round-icon-button" onClick={() => navigate('/ride')} aria-label="Go back"><IconArrowLeft size={18} /></button><h1>My ride requests</h1></header>
      <div className="my-requests-content">
        {requests.length ? requests.map((request) => <article className="my-request-row" key={request.ride.id}>
          <button className="my-request-main" onClick={() => navigate(`/ride/${request.ride.id}`)}>
            <span className="route-row"><IconMapPin size={13} /> <strong>{request.ride.pickup.split(',')[0]} → {request.ride.destination.split(',')[0]}</strong></span>
            <span className="request-date"><IconCalendar size={12} /> {request.ride.date} · {request.ride.time}</span>
          </button>
          <div className="request-row-footer"><span>Host: <strong>{request.ride.host?.fullName || 'Let’s Tumpang Host'}</strong></span><RequestStatus status={request.status} />{['Pending', 'Accepted'].includes(request.status) && <button onClick={() => setCancelling(request)}>Cancel</button>}</div>
        </article>) : <section className="empty-request-state"><span className="empty-car">🚗</span><strong>No requests yet</strong><p>Find a ride and submit your first request.</p><button className="primary-action" onClick={() => navigate('/ride')}>Find rides</button></section>}
      </div>
      {cancelling && <div className="sheet-backdrop" onMouseDown={() => setCancelling(null)}><section className="bottom-sheet" onMouseDown={(event) => event.stopPropagation()}><span className="sheet-handle" /><div className="sheet-title-row"><h2>Cancel request</h2><button onClick={() => setCancelling(null)}><IconX size={19} /></button></div><p>Why are you cancelling this request?</p><div className="reason-list">{reasons.map((item) => <button key={item} className={reason === item ? 'selected' : ''} onClick={() => setReason(item)}><i />{item}</button>)}</div>{reason === 'Other' && <textarea aria-label="Cancellation reason" placeholder="Describe your reason…" />}<button className="danger-button" disabled={!reason} onClick={cancel}>Confirm cancellation</button></section></div>}
    </main>
  );
}
