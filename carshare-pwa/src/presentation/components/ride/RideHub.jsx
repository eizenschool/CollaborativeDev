// ===== PRESENTATION LAYER (RideHub) =====
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideService } from '../../../business-logic/RideService.js';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import RideCard from './RideCard.jsx';
import { IconPlus, IconRoute, IconSearch, IconUsers } from '../icons.jsx';
import '../../styles/ride.css';

export default function RideHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [myRides, setMyRides] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMyRides = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [rides, joining] = await Promise.all([
        RideService.listMyRides(user.id),
        RideRequestService.listMyRequests(user.id)
      ]);
      setMyRides({ ...rides, joining });
    } catch (loadError) {
      setError(loadError.message || 'Unable to load your rides.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadMyRides(); }, [loadMyRides]);

  function openRide(ride, returnTo = '/ride') {
    navigate(`/ride/${ride.id}`, { state: { returnTo } });
  }

  return (
    <main className="ride-hub ride-management-hub">
      <header className="ride-hub-mobile-heading">
        <span className="ride-hero-icon" aria-hidden="true"><IconRoute size={22} /></span>
        <div>
          <p className="ride-hero-kicker">Ride workspace</p>
          <h1>My rides</h1>
          <p>Manage the journeys you host and the rides you asked to join.</p>
        </div>
      </header>

      <aside className="ride-hub-left">
        <section className="card ride-management-card" aria-labelledby="ride-management-title">
          <span className="ride-management-icon" aria-hidden="true"><IconRoute size={22} /></span>
          <p className="eyebrow">RIDE WORKSPACE</p>
          <h1 id="ride-management-title">My rides</h1>
          <p>Publish journeys, manage passengers, and keep track of rides you are joining.</p>
          <div className="ride-management-actions">
            <button className="btn-primary btn-publish" type="button" aria-label="Publish a ride" onClick={() => navigate('/ride/publish')}>
              <IconPlus size={17} /> <span>Publish a ride</span>
            </button>
            <button className="btn-secondary ride-request-button" type="button" onClick={() => navigate('/ride/requests')}>
              <IconUsers size={17} /> My requests
            </button>
          </div>
          <button className="btn-link ride-demand-link" type="button" onClick={() => navigate('/discover/demand')}>
            Where people want to go
          </button>
        </section>
      </aside>

      <section className="ride-hub-right" aria-busy={loading}>
        {error && (
          <div className="alert alert-error ride-management-error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn-link" onClick={loadMyRides}>Retry</button>
          </div>
        )}
        {loading && <div className="ride-page-loading compact" role="status">Loading your rides…</div>}
        {!loading && !error && myRides && (
          <MyRidesView
            myRides={myRides}
            onRideSelect={(ride) => openRide(ride)}
            onRequests={() => navigate('/ride/requests')}
            onSeeDemand={() => navigate('/discover/demand')}
            onFindRides={() => navigate('/search')}
          />
        )}
      </section>
    </main>
  );
}

function MyRidesView({ myRides, onRideSelect, onRequests, onSeeDemand, onFindRides }) {
  const hosting = myRides.hosting || [];
  const joining = myRides.joining || [];

  return (
    <>
      <div className="ride-hub-header">
        <div><p className="eyebrow">YOUR RIDES</p><h2>Hosting</h2></div>
        <button className="btn-link" type="button" onClick={onSeeDemand}>Where people want to go</button>
      </div>
      <div className="ride-grid">
        {hosting.length === 0 && (
          <section className="ride-empty-state compact">
            <h3>No hosted rides yet</h3>
            <p>Publish your first journey when you have seats to share, or see where people want to go.</p>
            <button className="btn-secondary" type="button" onClick={onSeeDemand}>See unmet demand</button>
          </section>
        )}
        {hosting.map((ride) => (
          <RideCard key={ride.id} ride={ride} statusChip onClick={() => onRideSelect(ride)} />
        ))}
      </div>

      <div className="ride-hub-header joining-header">
        <div><p className="eyebrow">PASSENGER VIEW</p><h2>Joining</h2></div>
        <button className="btn-link" type="button" onClick={onRequests}>View all requests</button>
      </div>
      <div className="ride-grid">
        {joining.length > 0 ? joining.map((request) => request.ride && (
          <button className="my-requests-link" type="button" key={request.id} onClick={() => onRideSelect(request.ride)}>
            {request.ride.pickup.split(',')[0]} → {request.ride.destination.split(',')[0]} · {request.seatsRequested} seat{request.seatsRequested === 1 ? '' : 's'} · {request.status}
          </button>
        )) : (
          <section className="ride-empty-state compact">
            <span aria-hidden="true"><IconSearch size={24} /></span>
            <h3>No rides you are joining yet</h3>
            <p>Use Smart Search to find a published ride and send a request to its Host.</p>
            <button className="btn-secondary" type="button" onClick={onFindRides}>Find rides</button>
          </section>
        )}
      </div>
    </>
  );
}
