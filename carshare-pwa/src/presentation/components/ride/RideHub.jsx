// ===== PRESENTATION LAYER (RideHub) =====
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideService } from '../../../business-logic/RideService.js';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import RideCard from './RideCard.jsx';
import { IconSearch, IconMapPin, IconCalendar, IconPlus, IconFilter } from '../icons.jsx';
import '../../styles/ride.css';

export default function RideHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('find'); // 'find' | 'my'
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myRides, setMyRides] = useState(null);

  useEffect(() => {
    search();
  }, []);

  useEffect(() => {
    if (tab === 'my' && !myRides && user) {
      Promise.all([RideService.listMyRides(user.id), RideRequestService.listMyRequests(user.id)])
        .then(([rides, joining]) => setMyRides({ ...rides, joining }));
    }
  }, [tab, user, myRides]);

  async function search(e) {
    e?.preventDefault();
    setLoading(true);
    try {
      setRides(await RideService.searchRides({ from, to, date }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ride-hub">
      <div className="ride-hub-mobile-heading">
        <h1>Let’s Tumpang <span>🚗</span></h1>
        <p>Find a shared journey or offer a seat.</p>
      </div>
      <div className="ride-hub-left">
        <div className="tabs">
          <button className={'tab' + (tab === 'find' ? ' active' : '')} onClick={() => setTab('find')}>Find a Ride</button>
          <button className={'tab' + (tab === 'my' ? ' active' : '')} onClick={() => setTab('my')}>My Rides</button>
        </div>

        {tab === 'find' && (
          <div className="card">
            <p className="card-title">Search Rides</p>
            <form onSubmit={search}>
              <div className="field">
                <div className="input-wrap">
                  <span className="prefix-icon"><IconMapPin size={14} /></span>
                  <input placeholder="From — pickup location" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <div className="input-wrap">
                  <span className="prefix-icon"><IconMapPin size={14} /></span>
                  <input placeholder="To — destination" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <div className="input-wrap">
                  <span className="prefix-icon"><IconCalendar size={14} /></span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <button className="btn-primary" type="submit"><IconSearch size={14} /> Search Rides</button>
            </form>
          </div>
        )}

        <button className="btn-primary btn-publish" onClick={() => navigate('/ride/publish')}>
          <IconPlus size={15} /> Publish a Ride
        </button>
      </div>

      <div className="ride-hub-right">
        {tab === 'find' && (
          <>
            <div className="ride-hub-header">
              <h2>{loading ? 'Searching…' : `${rides.length} ride${rides.length === 1 ? '' : 's'} available`}</h2>
              <button className="btn-secondary" type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconFilter size={14} /> Filters
              </button>
            </div>
            <div className="ride-grid">
              {rides.map((ride) => (
                <RideCard key={ride.id} ride={ride} onClick={() => navigate(`/ride/${ride.id}`)} />
              ))}
              {!loading && rides.length === 0 && (
                <p style={{ color: 'var(--muted)' }}>No rides match your search yet — try a different pickup, destination, or date.</p>
              )}
            </div>
          </>
        )}

        {tab === 'my' && (
          <MyRidesView myRides={myRides} onRideSelect={(ride) => navigate(`/ride/${ride.id}`)} onRequests={() => navigate('/ride/requests')} />
        )}
      </div>
    </div>
  );
}

function MyRidesView({ myRides, onRideSelect, onRequests }) {
  if (!myRides) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;

  return (
    <>
      <div className="ride-hub-header"><h2>Hosting</h2></div>
      <div className="ride-grid">
        {myRides.hosting.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>You haven't published any rides yet — use "Publish a Ride" to host your first one.</p>
        )}
        {myRides.hosting.map((ride) => (
          <RideCard key={ride.id} ride={ride} statusChip onClick={() => onRideSelect(ride)} />
        ))}
      </div>

      <div className="ride-hub-header" style={{ marginTop: 24 }}><h2>Joining</h2><button className="btn-link" onClick={onRequests}>My requests</button></div>
      <div className="ride-grid">
        {myRides.joining.length ? myRides.joining.map((request) => request.ride && <button className="my-requests-link" key={request.id} onClick={() => onRideSelect(request.ride)}>{request.ride.pickup.split(',')[0]} → {request.ride.destination.split(',')[0]} · {request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'} · {request.status}</button>) : <button className="my-requests-link" onClick={onRequests}>You have no ride requests yet.</button>}
      </div>
    </>
  );
}
