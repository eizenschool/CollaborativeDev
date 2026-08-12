// ===== PRESENTATION LAYER (TripDetail) =====
// Module 5, Screen 2 - FR-5.3 / FR-5.4 / FR-5.5 (UC5.3, UC5.4, UC5.5)
// Read-only - no edit affordances live here, that's Module 2's EditRide.jsx.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS, STATUS_COLORS } from './tripTheme.js';
import { useIsDesktop } from './useIsDesktop.js';
import { IconArrowLeftSmall, IconLeafSmall, IconMapPinSmall, IconUsersSmall } from './tripIcons.jsx';
import { ErrorState, NotFoundState } from './tripStates.jsx';
import './tripStyles.css';

export default function TripDetail() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
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
      <div style={{ minHeight: '100vh', background: COLORS.bg }}>
        <div className="m5-header">
          <button className="m5-back-btn" onClick={() => navigate('/trip')} aria-label="Back to my trips">
            <IconArrowLeftSmall size={18} />
          </button>
          <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 18, margin: 0, flex: 1, color: COLORS.textPrimary }}>
            Trip Details
          </h1>
        </div>
        <div style={{ padding: 24, maxWidth: 680, margin: '0 auto' }}>
          {state.phase === 'loading' && (
            <p style={{ fontFamily: 'Inter, sans-serif', color: COLORS.textSecondary }}>Loading trip…</p>
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
  const palette = STATUS_COLORS[trip.status] || STATUS_COLORS.Published;

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg }}>
      <div className="m5-header">
        <button className="m5-back-btn" onClick={() => navigate('/trip')}>
          <IconArrowLeftSmall size={18} />
        </button>
        <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 18, margin: 0, flex: 1, color: COLORS.textPrimary }}>
          Trip Details
        </h1>
        <span style={{ padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: palette.text, background: palette.bg }}>
          {trip.status}
        </span>
      </div>

      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', display: isDesktop ? 'grid' : 'block', gridTemplateColumns: isDesktop ? '65% 1fr' : undefined, gap: 24 }}>
        <div>
          <MapPreview pickup={trip.pickup} destination={trip.destination} />

          <div className="m5-card" style={{ padding: 20, marginBottom: 16 }}>
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
                {trip.restrictionTags.map((tag) => (
                  <span key={tag} className="m5-chip" style={{ cursor: 'default' }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="m5-card" style={{ padding: 20 }}>
            <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 15, margin: '0 0 10px', color: COLORS.textPrimary }}>
              Participants
            </h3>
            {trip.participants.map((p) => (
              <div key={p.id} className="m5-row" style={{ padding: '8px 4px', marginBottom: 0 }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: COLORS.primaryTint,
                    color: COLORS.primaryDark,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Poppins, sans-serif',
                    fontWeight: 600,
                    fontSize: 13,
                    flexShrink: 0
                  }}
                >
                  {p.name?.[0] || '?'}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, flex: 1, color: COLORS.textPrimary }}>{p.name}</span>
                <span style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 500 }}>{p.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <CarbonCard trip={trip} />
        </div>
      </div>
    </div>
  );
}

function MapPreview({ pickup, destination }) {
  return (
    <div
      className="m5-card"
      style={{
        height: 170,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        marginBottom: 16,
        background: `linear-gradient(135deg, ${COLORS.primaryTint} 0%, ${COLORS.bg} 100%)`
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <span className="m5-icon-circle" style={{ background: COLORS.surface, color: COLORS.primary, margin: '0 auto 6px', boxShadow: '0px 2px 8px rgba(0,0,0,0.08)' }}>
          <IconMapPinSmall size={20} />
        </span>
        <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textPrimary, margin: 0, maxWidth: 110 }}>{pickup}</p>
      </div>
      <div style={{ flex: 1, borderTop: `2px dashed ${COLORS.primary}`, opacity: 0.4, margin: '0 16px' }} />
      <div style={{ textAlign: 'center' }}>
        <span className="m5-icon-circle" style={{ background: COLORS.surface, color: COLORS.error, margin: '0 auto 6px', boxShadow: '0px 2px 8px rgba(0,0,0,0.08)' }}>
          <IconMapPinSmall size={20} />
        </span>
        <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.textPrimary, margin: 0, maxWidth: 110 }}>{destination}</p>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', fontFamily: 'Inter, sans-serif' }}>
      <span style={{ fontSize: 13, color: COLORS.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        {label}
      </span>
      <span style={{ fontSize: 14, color: COLORS.textPrimary, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function CarbonCard({ trip }) {
  if (trip.status !== 'Completed') {
    return (
      <div className="m5-card" style={{ padding: 20 }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          Carbon savings will be calculated once this trip is completed.
        </p>
      </div>
    );
  }
  return (
    <div style={{ background: `linear-gradient(160deg, ${COLORS.tealTint} 0%, #FFFFFF 100%)`, border: `1px solid ${COLORS.teal}`, borderRadius: 16, padding: 24, textAlign: 'center' }}>
      <span className="m5-icon-circle" style={{ background: COLORS.teal, color: '#FFFFFF', width: 52, height: 52 }}>
        <IconLeafSmall size={24} />
      </span>
      <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 34, color: COLORS.teal, margin: '4px 0 0' }}>
        {trip.carbonSavedKg} kg CO₂
      </p>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '6px 0 0', lineHeight: 1.5 }}>
        Estimated saved on this trip, based on distance and passengers carried.
      </p>
    </div>
  );
}