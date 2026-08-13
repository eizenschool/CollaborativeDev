// ===== PRESENTATION LAYER (RideHistory) =====
// Module 5, Screen 1 - FR-5.1 / FR-5.2 (UC5.1, UC5.2)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS, STATUS_COLORS } from './tripTheme.js';
import { useIsDesktop } from './useIsDesktop.js';
import { IconLeafSmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';

// The seven lifecycle states Module 2 actually stores on a ride. 'Expired'
// belongs here too - a published ride nobody joined lapses rather than
// completing, and without a chip it would only ever appear under 'All'.
const STAGES = ['All', 'Draft', 'Published', 'Matched', 'In Transit', 'Completed', 'Expired', 'Cancelled'];
const ROLES = ['All', 'Hosted', 'Joined'];

export default function RideHistory({ userId, onOpenTrip }) {
  const isDesktop = useIsDesktop();
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [stage, setStage] = useState('All');
  const [role, setRole] = useState('All');

  useEffect(() => {
    let active = true;
    if (!userId) return;
    setState({ phase: 'loading' });
    TripHistoryEngine.listHistory(userId)
      .then((data) => {
        if (active) setState({ phase: 'ready', trips: data });
      })
      .catch((error) => {
        if (active) setState({ phase: 'error', message: error.message });
      });
    return () => {
      active = false;
    };
  }, [userId, reloadToken]);

  const trips = state.phase === 'ready' ? state.trips : null;

  const filtered = useMemo(() => {
    if (!trips) return [];
    return trips.filter((t) => {
      const stageOk = stage === 'All' || t.status === stage;
      const roleOk =
        role === 'All' || (role === 'Hosted' && t.role === 'Host') || (role === 'Joined' && t.role === 'Passenger');
      return stageOk && roleOk;
    });
  }, [trips, stage, role]);

  if (state.phase === 'error') {
    return <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />;
  }

  if (state.phase === 'loading') {
    return <p style={{ color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>Loading your trips…</p>;
  }

  return (
    <div style={{ display: isDesktop ? 'grid' : 'block', gridTemplateColumns: isDesktop ? '260px 1fr' : undefined, gap: 28 }}>
      <div>
        <FilterGroup label="Status" options={STAGES} value={stage} onChange={setStage} />
        <div style={{ height: 20 }} />
        <SegmentedRoleToggle value={role} onChange={setRole} />
      </div>

      <div>
        {filtered.length === 0 ? (
          <EmptyState stageFiltered={stage !== 'All'} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(2, 1fr)' : '1fr', gap: 16 }}>
            {filtered.map((trip) => (
              <TripCard key={trip.id} trip={trip} onClick={() => onOpenTrip(trip.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// These groups pick exactly one option, so they are radio groups rather than
// plain buttons. That also keeps the whole group to a single Tab stop - as
// loose buttons the eleven filters sat between the page and the trip list.
function useRovingRadioGroup(options, value, onChange) {
  const refs = useRef([]);
  const register = (index) => (node) => { refs.current[index] = node; };

  function handleKeyDown(event, index) {
    const last = options.length - 1;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next]);
    refs.current[next]?.focus();
  }

  // Roving tabindex: the checked option carries the tab stop, arrows do the rest.
  const optionProps = (opt, index) => ({
    ref: register(index),
    role: 'radio',
    'aria-checked': value === opt,
    tabIndex: value === opt ? 0 : -1,
    onClick: () => onChange(opt),
    onKeyDown: (event) => handleKeyDown(event, index)
  });

  return optionProps;
}

function FilterGroup({ label, options, value, onChange }) {
  const optionProps = useRovingRadioGroup(options, value, onChange);
  const labelId = `m5-filter-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <p
        id={labelId}
        style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: COLORS.textSecondary, margin: '0 0 10px' }}
      >
        {label}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="radiogroup" aria-labelledby={labelId}>
        {options.map((opt, index) => {
          const active = value === opt;
          const palette = STATUS_COLORS[opt];
          const activeColor = palette ? palette.text : COLORS.primaryDark;
          return (
            <button
              key={opt}
              className="m5-chip"
              {...optionProps(opt, index)}
              style={{
                borderColor: active ? activeColor : COLORS.border,
                background: active ? (palette ? palette.bg : COLORS.primaryTint) : COLORS.surface,
                color: active ? activeColor : COLORS.textSecondary,
                fontWeight: active ? 600 : 500
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedRoleToggle({ value, onChange }) {
  const optionProps = useRovingRadioGroup(ROLES, value, onChange);
  return (
    <div
      style={{ display: 'inline-flex', background: COLORS.bg, borderRadius: 12, padding: 4, border: `1px solid ${COLORS.border}` }}
      role="radiogroup"
      aria-label="Filter by your role"
    >
      {ROLES.map((opt, index) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            {...optionProps(opt, index)}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              background: active ? COLORS.surface : 'transparent',
              color: active ? COLORS.primaryDark : COLORS.textSecondary,
              boxShadow: active ? '0px 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function TripCard({ trip, onClick }) {
  const palette = STATUS_COLORS[trip.status] || STATUS_COLORS.Published;
  return (
    <button onClick={onClick} className="m5-card m5-trip-card" style={{ padding: 18, fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 15, margin: 0, color: COLORS.textPrimary, lineHeight: 1.4 }}>
          {trip.pickup} → {trip.destination}
        </p>
        <span style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: palette.text, background: palette.bg }}>
          {trip.status}
        </span>
      </div>
      <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '8px 0 0' }}>
        {trip.date} · {trip.time}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.teal, background: COLORS.tealTint, padding: '3px 10px', borderRadius: 999 }}>
          {trip.role}
        </span>
        {trip.carbonSavedKg != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: COLORS.teal }}>
            <IconLeafSmall size={14} /> {trip.carbonSavedKg} kg CO₂ saved
          </span>
        )}
      </div>
    </button>
  );
}

function EmptyState({ stageFiltered }) {
  return (
    <div className="m5-card m5-empty">
      <span className="m5-icon-circle" style={{ background: COLORS.bg, color: COLORS.textSecondary }}>
        <IconLeafSmall size={20} />
      </span>
      <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 16, color: COLORS.textPrimary, margin: 0 }}>
        {stageFiltered ? 'No trips found under selected status' : 'No ride history found'}
      </p>
      <p style={{ fontSize: 14, marginTop: 6 }}>
        {stageFiltered
          ? 'Try a different status filter, or check back after your next ride.'
          : 'Trips you host or join will show up here once you take your first ride.'}
      </p>
    </div>
  );
}