import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RideService } from '../../../business-logic/RideService.js';
import { IconArrowLeft, IconCheck, IconStar, IconUsers } from '../icons.jsx';
import '../../styles/ride.css';

const initialRequests = [
  { id: 'request_1', name: 'Aina Farhana', score: 4.9, tier: 'Gold', requested: '10 min ago', status: 'Pending' },
  { id: 'request_2', name: 'Daniel Lim', score: 4.7, tier: 'Silver', requested: '28 min ago', status: 'Pending' },
  { id: 'request_3', name: 'Priya Nair', score: 4.8, tier: 'Gold', requested: 'Yesterday', status: 'Accepted' },
  { id: 'request_4', name: 'Hafiz Rahman', score: 4.5, tier: 'Bronze', requested: 'Yesterday', status: 'Rejected' }
];

function avatar(name) {
  return name.split(' ').map((word) => word[0]).slice(0, 2).join('');
}

export default function ManageRequests() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [requests, setRequests] = useState(initialRequests);
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => { RideService.getRide(rideId).then(setRide); }, [rideId]);
  const pending = requests.filter((request) => request.status === 'Pending');
  const accepted = requests.filter((request) => request.status === 'Accepted');
  const rejected = requests.filter((request) => request.status === 'Rejected');
  const seats = ride?.seatsAvailable ?? 3;
  const update = (id, status) => setRequests((current) => current.map((request) => request.id === id ? { ...request, status } : request));

  function RequestCard({ request, actions = false, muted = false }) {
    return (
      <article className={`passenger-request-card ${muted ? 'muted' : ''}`}>
        <span className="request-avatar">{avatar(request.name)}</span>
        <div className="request-person"><strong>{request.name}</strong><span><IconStar size={11} /> {request.score} <b className="tier-badge">{request.tier}</b> <small>{request.requested}</small></span></div>
        {actions && <div className="request-actions"><button onClick={() => update(request.id, 'Rejected')}>Reject</button><button onClick={() => update(request.id, 'Accepted')}>Accept</button></div>}
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
        <section className="request-stats">
          <div><strong>{pending.length}</strong><span>Pending</span></div>
          <div><strong>{accepted.length}</strong><span>Accepted</span></div>
          <div><strong>{Math.max(0, seats - accepted.length)}</strong><span>Seats left</span></div>
        </section>

        {accepted.length > 0 && <section className="request-group"><h2 className="accepted-heading"><IconCheck size={13} /> Accepted ({accepted.length})</h2>{accepted.map((request) => <RequestCard request={request} key={request.id} />)}</section>}
        {pending.length > 0 ? <section className="request-group"><h2 className="pending-heading">◷ Pending ({pending.length})</h2>{pending.map((request) => <RequestCard request={request} actions key={request.id} />)}</section>
          : <section className="empty-request-state"><IconUsers size={34} /><strong>No pending requests</strong><p>New passenger requests will appear here.</p></section>}

        {rejected.length > 0 && <section className="request-group rejected-group"><button className="rejected-toggle" onClick={() => setShowRejected((show) => !show)}>⌄ Rejected ({rejected.length})</button>{showRejected && rejected.map((request) => <RequestCard request={request} muted key={request.id} />)}</section>}
      </div>
    </main>
  );
}
