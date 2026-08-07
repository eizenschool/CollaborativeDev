import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideService } from '../../../business-logic/RideService.js';
import {
  IconAlertTriangle, IconArrowLeft, IconCalendar, IconCheck, IconEdit,
  IconMapPin, IconRoute, IconStar, IconUsers, IconX
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
    <div className="ride-map" aria-label={`Route from ${ride.pickup} to ${ride.destination}`}>
      <span className="map-grid map-grid-a" />
      <span className="map-grid map-grid-b" />
      <span className="map-route" />
      <span className="map-point map-point-start" />
      <span className="map-point map-point-end" />
      <span className="map-label map-label-start">{ride.pickup?.split(',')[0]}</span>
      <span className="map-label map-label-end">{ride.destination?.split(',')[0]}</span>
    </div>
  );
}

function Lifecycle({ status }) {
  const active = LIFECYCLE.indexOf(status);
  const cancelled = status === 'Cancelled';
  return (
    <div className="lifecycle" aria-label={`Ride status: ${status}`}>
      {LIFECYCLE.map((label, index) => (
        <div className="lifecycle-step" key={label}>
          <span className={`lifecycle-dot ${!cancelled && index <= active ? 'done' : ''}`}>{index < active && !cancelled ? <IconCheck size={11} /> : index + 1}</span>
          <span className={!cancelled && index === active ? 'active' : ''}>{label}</span>
          {index < LIFECYCLE.length - 1 && <i className={!cancelled && index < active ? 'filled' : ''} />}
        </div>
      ))}
      {cancelled && <span className="ride-status-badge status-cancelled">Cancelled</span>}
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

function CancelSheet({ onDismiss, onConfirm }) {
  const [reason, setReason] = useState('');
  const reasons = ['Change of plans', 'Vehicle issue', 'Emergency', 'Other'];
  return (
    <div className="sheet-backdrop" onMouseDown={onDismiss}>
      <section className="bottom-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <span className="sheet-handle" />
        <div className="sheet-title-row"><h2>Cancel this ride?</h2><button onClick={onDismiss} aria-label="Close"><IconX size={19} /></button></div>
        <p>Let passengers know why this ride is no longer available.</p>
        <div className="reason-list">
          {reasons.map((item) => <button className={reason === item ? 'selected' : ''} key={item} onClick={() => setReason(item)}><i />{item}</button>)}
        </div>
        <button className="danger-button" disabled={!reason} onClick={() => onConfirm(reason)}>Confirm cancellation</button>
      </section>
    </div>
  );
}

export default function RideDetail() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requestSent, setRequestSent] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let alive = true;
    RideService.getRide(rideId, user?.id).then((found) => {
      if (alive) setRide(found);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [rideId, user?.id]);

  if (loading) return <div className="ride-page-loading">Loading ride…</div>;
  if (!ride) return <div className="ride-page-loading">This ride could not be found.</div>;

  const isHost = ride.hostId === user?.id;
  const canEdit = isHost && ['Draft', 'Published'].includes(ride.status);
  const canCancel = isHost && ['Published', 'Matched'].includes(ride.status);
  const waypoints = ride.waypoints?.length ? ride.waypoints : ride.journeyScale === 'Intercity'
    ? [{ name: 'Ipoh Old Town', description: 'A food stop along the way.' }, { name: 'Taiping Lake Gardens', description: 'A cultural stop by the route.' }]
    : [];

  async function cancelRide() {
    await RideService.updateRide(ride.id, { status: 'Cancelled' });
    setRide((current) => ({ ...current, status: 'Cancelled' }));
    setCancelling(false);
  }

  return (
    <main className="phone-ride-page ride-detail-page">
      <div className="ride-detail-map-wrap">
        <RouteMap ride={ride} />
        <button className="map-back-button" onClick={() => navigate('/ride')} aria-label="Go back"><IconArrowLeft size={18} /></button>
        <span className={`ride-status-badge ${statusClass(ride.status)}`}>{ride.status}</span>
      </div>

      <div className="ride-detail-content">
        <section className="ride-info-card"><Lifecycle status={ride.status} /></section>
        <section className="ride-info-card trip-info-mobile">
          <div className="trip-title-row"><h1>{ride.pickup?.split(',')[0]} <span>→</span> {ride.destination?.split(',')[0]}</h1><b className="scale-badge">{ride.journeyScale}</b></div>
          <div className="trip-detail-grid">
            <div><span><IconMapPin size={13} /> Pickup</span><strong>{ride.pickup}</strong></div>
            <div><span className="destination-icon"><IconMapPin size={13} /> Destination</span><strong>{ride.destination}</strong></div>
            <div><span><IconCalendar size={13} /> Date</span><strong>{formatDate(ride.date)}</strong></div>
            <div><span>◷ Time</span><strong>{formatTime(ride.time)}</strong></div>
          </div>
          <p className="seats-left"><IconUsers size={15} /> {ride.seatsAvailable} seat{ride.seatsAvailable === 1 ? '' : 's'} available</p>
        </section>

        <section className="fixed-route-note"><IconAlertTriangle size={16} /><span>This ride follows a <strong>fixed route</strong> — requests with a significant detour are automatically declined.</span></section>

        <section className="ride-info-card ride-preferences">
          <div><p className="eyebrow">RESTRICTIONS</p><div className="ride-tag-list">{ride.restrictionTags?.length ? ride.restrictionTags.map((tag) => <span key={tag}>{tag}</span>) : <small>No restrictions added</small>}</div></div>
          <div className="contribution"><p className="eyebrow">NON-MONETARY CONTRIBUTION</p><strong>🤝 {ride.contribution || 'No contribution needed'}</strong></div>
        </section>

        {waypoints.length > 0 && <section className="waypoints-section"><h2>🗺️ Culinary & cultural waypoints</h2><div className="waypoint-scroller">{waypoints.map((waypoint) => <article key={waypoint.name}><div className="waypoint-art">✦</div><strong>{waypoint.name}</strong><p>{waypoint.description}</p></article>)}</div></section>}
        <HostIdentity ride={ride} />
      </div>

      <div className="ride-bottom-actions">
        {isHost ? <>
          <div className="host-action-row">
            {canEdit && <button className="outline-action" onClick={() => navigate(`/ride/${ride.id}/edit`)}><IconEdit size={15} /> Edit ride</button>}
            <button className="primary-action" onClick={() => navigate(`/ride/${ride.id}/requests`)}><IconUsers size={15} /> Manage requests</button>
          </div>
          {canCancel && <button className="cancel-action" onClick={() => setCancelling(true)}>Cancel this ride</button>}
        </> : ride.status === 'Completed' ? <button className="primary-action full" onClick={() => navigate(`/ride/${ride.id}/review`)}>★ Rate & review</button>
          : requestSent ? <div className="request-sent"><IconCheck size={15} /> Request sent — awaiting approval</div>
            : <button className="primary-action full" onClick={() => setRequestSent(true)}>Request to join</button>}
      </div>
      {cancelling && <CancelSheet onDismiss={() => setCancelling(false)} onConfirm={cancelRide} />}
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
