// ===== PRESENTATION LAYER (TripDetail) =====
// Module 5, Screen 2 - FR-5.3 / FR-5.4 / FR-5.5 (UC5.3, UC5.4, UC5.5)
// Read-only - no edit affordances live here, that's Module 2's EditRide.jsx.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS } from './tripTheme.js';
import GoogleRouteMap from '../maps/GoogleRouteMap.jsx';
import { IconArrowLeftSmall, IconLeafSmall, IconMapPinSmall, IconUsersSmall } from './tripIcons.jsx';
import { ErrorState, NotFoundState } from './tripStates.jsx';
import TripTimelineCard from './TripTimelineCard.jsx';
import TripRouteReplay from './TripRouteReplay.jsx';
import { StatusBadge } from '../ui/Primitives.jsx';
import { RouteLoading } from '../ui/RouteState.jsx';
import './tripStyles.css';

function statusTone(status) {
  if (status === 'Completed') return 'success';
  if (['Cancelled', 'Expired'].includes(status)) return 'danger';
  if (status === 'In Transit') return 'info';
  if (status === 'Matched') return 'warning';
  return 'neutral';
}

export default function TripDetail() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  // 'loading' and 'not found' used to be the same value, so UC5.3's A1 branch
  // could never render - a missing or forbidden trip sat on "Loading trip…"
  // forever. They are separate phases now.
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    if (!user?.id) return;
    setState({ phase: 'loading' });
    TripHistoryEngine.getTripDetail(tripId, user.id)
      .then((data) => {
        if (!active) return;
        setState(data ? { phase: 'ready', trip: data } : { phase: 'notFound' });
      })
      .catch((error) => {
        if (active) setState({ phase: 'error', message: error.message });
      });
    return () => {
      active = false;
    };
  }, [tripId, user?.id, reloadToken]);

  if (state.phase !== 'ready') {
    return (
      <div className="m5-root">
        <div className="m5-header">
          <button className="m5-back-btn" onClick={() => navigate('/trip')} aria-label="Back to my trips">
            <IconArrowLeftSmall size={18} />
          </button>
          <h1 className="m5-detail-title">Trip details</h1>
        </div>
        <div className="m5-detail-state">
          {state.phase === 'loading' && (
            <RouteLoading label="Loading trip" />
          )}
          {state.phase === 'error' && (
            <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
          )}
          {state.phase === 'notFound' && <NotFoundState onBack={() => navigate('/trip')} />}
        </div>
      </div>
    );
  }

  const trip = state.trip;

  return (
    <div className="m5-root">
      <div className="m5-header">
        <button className="m5-back-btn" onClick={() => navigate('/trip')} aria-label="Back to my trips">
          <IconArrowLeftSmall size={18} />
        </button>
        <h1 className="m5-detail-title">Trip details</h1>
        <StatusBadge tone={statusTone(trip.status)}>{trip.status}</StatusBadge>
      </div>

      <div className="m5-detail-layout">
        <div>
          <MapPreview trip={trip} />
          {['Completed', 'Cancelled', 'Expired'].includes(trip.status) && <TripRouteReplay trip={trip} />}

          <div className="m5-card m5-detail-info-card">
            <InfoRow icon={<IconMapPinSmall size={16} />} label="Pickup" value={trip.pickup} />
            <InfoRow icon={<IconMapPinSmall size={16} />} label="Destination" value={trip.destination} />
            <InfoRow label="Departure" value={`${trip.date} · ${trip.time}`} />
            <InfoRow label="Your role" value={trip.role} />
            <InfoRow
              icon={<IconUsersSmall size={16} />}
              label="Seats"
              value={`${trip.seatsTotal - trip.seatsAvailable} / ${trip.seatsTotal} filled`}
            />
            {trip.contribution && <InfoRow label="Contribution" value={trip.contribution} />}
            {trip.restrictionTags?.length > 0 && (
              <div className="m5-detail-tags">
                {trip.restrictionTags.map((tag) => (
                  <span key={tag} className="m5-chip" style={{ cursor: 'default' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="m5-card m5-detail-participants">
            <h3>
              Participants
            </h3>
            {trip.participants.map((p) => (
              <div key={p.id} className="m5-row m5-participant-row">
                <span className="m5-participant-avatar">
                  {p.name?.[0] || '?'}
                </span>
                <span className="m5-participant-name">{p.name}</span>
                <span className="m5-participant-role">{p.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <CarbonCard trip={trip} />
          <TripTimelineCard timeline={trip.timeline} />
        </div>
      </div>
    </div>
  );
}

// The shared Maps Embed component (maps/GoogleRouteMap.jsx), the same one
// Module 2's RideDetail uses - this screen used to draw its own two-pins-and-a-
// dashed-line graphic instead, which UI.md rules out ("do not create
// module-local copies of shared UI").
//
// That graphic is not thrown away: it is now the children GoogleRouteMap falls
// back to when no Embed key is configured or the network is unavailable, which
// is the role it should have had all along.
function MapPreview({ trip }) {
  return (
    <GoogleRouteMap
      className="m5-card m5-map"
      pickup={trip.pickup}
      pickupLocation={trip.pickupLocation}
      destination={trip.destination}
      destinationLocation={trip.destinationLocation}
    >
      <div style={{ textAlign: 'center' }}>
        <span className="m5-icon-circle" style={{ background: COLORS.surface, color: COLORS.primary, margin: '0 auto 6px', boxShadow: '0px 2px 8px rgba(0,0,0,0.08)' }}>
          <IconMapPinSmall size={20} />
        </span>
        <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textPrimary, margin: 0, maxWidth: 110 }}>{trip.pickup}</p>
      </div>
      <div style={{ flex: 1, borderTop: `2px dashed ${COLORS.primary}`, opacity: 0.4, margin: '0 16px' }} />
      <div style={{ textAlign: 'center' }}>
        <span className="m5-icon-circle" style={{ background: COLORS.surface, color: COLORS.error, margin: '0 auto 6px', boxShadow: '0px 2px 8px rgba(0,0,0,0.08)' }}>
          <IconMapPinSmall size={20} />
        </span>
        <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textPrimary, margin: 0, maxWidth: 110 }}>{trip.destination}</p>
      </div>
    </GoogleRouteMap>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="m5-detail-info-row">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function CarbonCard({ trip }) {
  if (trip.status !== 'Completed') {
    return (
      <div className="m5-card m5-carbon-pending">
        <p>
          Carbon savings will be calculated once this trip is completed.
        </p>
      </div>
    );
  }
  return (
    <div className="m5-carbon-card">
      <span className="m5-icon-circle m5-carbon-icon">
        <IconLeafSmall size={24} />
      </span>
      <p className="m5-carbon-value">
        {trip.carbonSavedKg} kg CO₂
      </p>
      <p className="m5-carbon-caption">
        Estimated saved on this trip, based on distance and passengers carried.
      </p>
    </div>
  );
}
