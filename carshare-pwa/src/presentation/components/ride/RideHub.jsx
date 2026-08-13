// ===== PRESENTATION LAYER (RideHub) =====
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import { RideService } from '../../../business-logic/RideService.js';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import RideCard from './RideCard.jsx';
import { IconSearch, IconMapPin, IconCalendar, IconPlus, IconRoute } from '../icons.jsx';
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
  const [error, setError] = useState('');

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
    setError('');
    try {
      setRides(await RideService.searchRides({ from, to, date }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function openMemberService(destination, reason) {
    const target = getAuthNavigation(user, destination, reason);
    navigate(target.to, { state: target.state });
  }

  function openMyRides() {
    if (!user) {
      openMemberService('/ride', 'Sign in to view the rides you host or requested.');
      return;
    }
    setTab('my');
  }

  return (
    <div className="ride-hub">
      <header className="ride-hub-mobile-heading">
        <span className="ride-hero-icon" aria-hidden="true"><IconRoute size={22} /></span>
        <div>
          <p className="ride-hero-kicker">Travel better, together</p>
          <h1>Where are you headed?</h1>
          <p>Find a trusted shared journey or offer your empty seats.</p>
        </div>
      </header>
      <div className="ride-hub-left">
        <div className="tabs" role="tablist" aria-label="Ride workspace">
          <button role="tab" aria-selected={tab === 'find'} className={'tab' + (tab === 'find' ? ' active' : '')} onClick={() => setTab('find')}>Find a ride</button>
          <button role="tab" aria-selected={tab === 'my'} className={'tab' + (tab === 'my' ? ' active' : '')} onClick={openMyRides}>My rides</button>
        </div>

        {tab === 'find' && (
          <section className="card ride-search-card" aria-labelledby="ride-search-title">
            <div className="ride-search-heading">
              <div>
                <p className="eyebrow">PLAN YOUR JOURNEY</p>
                <h2 id="ride-search-title">Find the right ride</h2>
              </div>
              <IconSearch size={19} aria-hidden="true" />
            </div>
            <form onSubmit={search}>
              <div className="field">
                <label htmlFor="ride-search-from">Pickup</label>
                <div className="input-wrap">
                  <span className="prefix-icon"><IconMapPin size={14} /></span>
                  <input id="ride-search-from" autoComplete="street-address" placeholder="e.g. KL Sentral" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ride-search-to">Destination</label>
                <div className="input-wrap">
                  <span className="prefix-icon"><IconMapPin size={14} /></span>
                  <input id="ride-search-to" autoComplete="street-address" placeholder="e.g. Georgetown" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ride-search-date">Travel date</label>
                <div className="input-wrap">
                  <span className="prefix-icon"><IconCalendar size={14} /></span>
                  <input id="ride-search-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <button className="btn-primary" type="submit" disabled={loading}><IconSearch size={16} /> {loading ? 'Searching…' : 'Search rides'}</button>
            </form>
          </section>
        )}

        <button className="btn-primary btn-publish" onClick={() => openMemberService('/ride/publish', 'Sign in before publishing a ride.') }>
          <IconPlus size={17} /> <span>Publish a ride</span>
        </button>
      </div>

      <div className="ride-hub-right">
        {tab === 'find' && (
          <>
            <div className="ride-hub-header">
              <div>
                <p className="eyebrow">AVAILABLE JOURNEYS</p>
                <h2>{loading ? 'Searching nearby rides…' : `${rides.length} ride${rides.length === 1 ? '' : 's'} found`}</h2>
              </div>
              {!loading && <span className="result-count" aria-label={`${rides.length} search results`}>{rides.length}</span>}
            </div>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <div className="ride-grid">
              {rides.map((ride) => (
                <RideCard key={ride.id} ride={ride} onClick={() => navigate(`/ride/${ride.id}`)} />
              ))}
              {!loading && rides.length === 0 && (
                <section className="ride-empty-state">
                  <span aria-hidden="true"><IconSearch size={24} /></span>
                  <h3>No matching rides yet</h3>
                  <p>Try a nearby pickup point, another destination, or a different travel date.</p>
                  <button type="button" className="btn-secondary" onClick={() => { setFrom(''); setTo(''); setDate(''); }}>Clear search</button>
                </section>
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
  if (!myRides) return <div className="ride-page-loading compact" role="status">Loading your rides…</div>;

  return (
    <>
      <div className="ride-hub-header"><div><p className="eyebrow">YOUR RIDES</p><h2>Hosting</h2></div></div>
      <div className="ride-grid">
        {myRides.hosting.length === 0 && (
          <section className="ride-empty-state compact"><h3>No hosted rides yet</h3><p>Publish your first journey when you have seats to share.</p></section>
        )}
        {myRides.hosting.map((ride) => (
          <RideCard key={ride.id} ride={ride} statusChip onClick={() => onRideSelect(ride)} />
        ))}
      </div>

      <div className="ride-hub-header joining-header"><div><p className="eyebrow">PASSENGER VIEW</p><h2>Joining</h2></div><button className="btn-link" onClick={onRequests}>View all requests</button></div>
      <div className="ride-grid">
        {myRides.joining.length ? myRides.joining.map((request) => request.ride && <button className="my-requests-link" key={request.id} onClick={() => onRideSelect(request.ride)}>{request.ride.pickup.split(',')[0]} → {request.ride.destination.split(',')[0]} · {request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'} · {request.status}</button>) : <button className="my-requests-link" onClick={onRequests}>You have no ride requests yet.</button>}
      </div>
    </>
  );
}
