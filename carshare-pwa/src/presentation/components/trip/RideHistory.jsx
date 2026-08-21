// ===== PRESENTATION LAYER (RideHistory) =====
// Module 5, Screen 1 - FR-5.1 / FR-5.2 (UC5.1, UC5.2)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TripHistoryEngine,
  groupHistoryByMonth,
  summariseHistory
} from '../../../business-logic/TripHistoryEngine.js';
import { COLORS, STATUS_COLORS } from './tripTheme.js';
import { useIsDesktop } from './useIsDesktop.js';
import { IconLeafSmall, IconRoadSmall, IconUsersSmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';
import MonthStepper from './MonthStepper.jsx';
import StatTile from './StatTile.jsx';

// The seven lifecycle states Module 2 actually stores on a ride. 'Expired'
// belongs here too - a published ride nobody joined lapses rather than
// completing, and without a chip it would only ever appear under 'All'.
const STAGES = ['All', 'Draft', 'Published', 'Matched', 'In Transit', 'Completed', 'Expired', 'Cancelled'];
const ROLES = ['All', 'Hosted', 'Joined'];

export default function RideHistory({ userId, onOpenTrip }) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [period, setPeriod] = useState('all');
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

  const summary = useMemo(() => summariseHistory(trips || []), [trips]);

  // The oldest trip is the floor: paging back past it could only ever show
  // empty months.
  const earliest = useMemo(() => {
    if (!trips || trips.length === 0) return null;
    const oldest = trips.reduce((min, t) => (t.date < min ? t.date : min), trips[0].date);
    const [year, month] = oldest.split('-').map(Number);
    return { year, month: month - 1 };
  }, [trips]);

  const filtered = useMemo(() => {
    if (!trips) return [];
    const periodKey = period === 'all'
      ? null
      : `${period.year}-${String(period.month + 1).padStart(2, '0')}`;
    return trips.filter((t) => {
      if (periodKey && t.date.slice(0, 7) !== periodKey) return false;
      const stageOk = stage === 'All' || t.status === stage;
      const roleOk =
        role === 'All' || (role === 'Hosted' && t.role === 'Host') || (role === 'Joined' && t.role === 'Passenger');
      return stageOk && roleOk;
    });
  }, [trips, stage, role, period]);

  const months = useMemo(() => groupHistoryByMonth(filtered), [filtered]);

  if (state.phase === 'error') {
    return <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />;
  }

  if (state.phase === 'loading') {
    return <p style={{ color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>Loading your trips…</p>;
  }

  return (
    <div>
      {/* Real counts, so the page opens with figures rather than a filter rail
          and empty space - and reads 0 rather than vanishing before any trip. */}
      <div className="m5-stat-grid cols-4">
        <StatTile icon={<IconLeafSmall size={17} />} label="CO₂ saved" value={`${summary.carbonSavedKg} kg`} accent />
        <StatTile label="Trips" value={summary.total} />
        <StatTile label="Hosted" value={summary.hosted} />
        <StatTile label="Joined" value={summary.joined} />
      </div>

      {/* One scrolling row rather than a narrow column: eight chips of unequal
          width wrapped into ragged rows and left the list squeezed beside them. */}
      <div className="m5-history-filters">
        <div className="m5-history-period">
          {period === 'all' ? (
            <button
              className="m5-chip active-period"
              onClick={() => setPeriod({ year: new Date().getFullYear(), month: new Date().getMonth() })}
              disabled={!earliest}
            >
              All time <span className="m5-chip-count">{summary.total}</span>
            </button>
          ) : (
            <MonthStepper
              year={period.year}
              month={period.month}
              earliest={earliest}
              onChange={(y, m) => setPeriod({ year: y, month: m })}
              trailing={
                <button className="m5-chip" onClick={() => setPeriod('all')}>All time</button>
              }
            />
          )}
        </div>
        <FilterGroup
          label="Status"
          options={STAGES}
          value={stage}
          onChange={setStage}
          counts={summary.byStatus}
          total={summary.total}
        />
        <SegmentedRoleToggle value={role} onChange={setRole} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          stage={stage}
          role={role}
          summary={summary}
          onPickStage={setStage}
          onClearFilters={() => { setStage('All'); setRole('All'); setPeriod('all'); }}
          onFindRide={() => navigate('/ride')}
          onPublishRide={() => navigate('/ride/publish')}
        />
      ) : (
        months.map((group) => (
          <section key={group.key} className="m5-month">
            <h3 className="m5-section-title m5-month-heading">
              {group.label}
              <span>{group.trips.length} {group.trips.length === 1 ? 'trip' : 'trips'}</span>
            </h3>
            <div className="m5-trip-grid">
              {group.trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} onClick={() => onOpenTrip(trip.id)} />
              ))}
            </div>
          </section>
        ))
      )}
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

function FilterGroup({ label, options, value, onChange, counts = {}, total = 0 }) {
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
      <div className="m5-chip-row" role="radiogroup" aria-labelledby={labelId}>
        {options.map((opt, index) => {
          const active = value === opt;
          const count = opt === 'All' ? total : (counts[opt] || 0);
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
              {/* A filter that shows what it holds saves a click on an empty one. */}
              <span className="m5-chip-count" style={{ opacity: count === 0 ? 0.45 : 1 }}>{count}</span>
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
  const seatsFilled = Math.max(0, (trip.seatsTotal || 0) - (trip.seatsAvailable ?? 0));
  const counterpart = trip.role === 'Passenger' ? trip.host?.fullName : null;

  return (
    <button onClick={onClick} className="m5-card m5-trip-card">
      <div className="m5-trip-head">
        <p className="m5-trip-route">{trip.pickup} → {trip.destination}</p>
        <span className="m5-trip-status" style={{ color: palette.text, background: palette.bg }}>
          {trip.status}
        </span>
      </div>

      <div className="m5-trip-meta">
        <span>{trip.date} · {trip.time}</span>
        <span aria-hidden="true">·</span>
        <span>{trip.journeyScale}</span>
      </div>

      <div className="m5-trip-facts">
        <span className="m5-trip-fact">
          <IconUsersSmall size={14} /> {seatsFilled}/{trip.seatsTotal} seats
        </span>
        {trip.distanceKm != null && (
          <span className="m5-trip-fact">
            <IconRoadSmall size={14} /> ~{trip.distanceKm} km
          </span>
        )}
        {trip.contribution && <span className="m5-trip-fact">{trip.contribution}</span>}
      </div>

      {trip.restrictionTags?.length > 0 && (
        <div className="m5-trip-tags">
          {trip.restrictionTags.slice(0, 3).map((tag) => (
            <span key={tag} className="m5-trip-tag">{tag}</span>
          ))}
          {trip.restrictionTags.length > 3 && (
            <span className="m5-trip-tag">+{trip.restrictionTags.length - 3}</span>
          )}
        </div>
      )}

      <div className="m5-trip-foot">
        <span className="m5-trip-role">
          {/* Whose trip this was matters more to a passenger than to a host. */}
          {counterpart ? `Passenger · ${counterpart}` : trip.role}
        </span>
        {trip.carbonSavedKg != null && (
          <span className="m5-trip-carbon">
            <IconLeafSmall size={14} /> {trip.carbonSavedKg} kg CO₂
          </span>
        )}
      </div>
    </button>
  );
}

// Two different situations deserve two different answers. A filtered-out list
// is a navigation problem - the fastest fix is one tap onto a status that has
// something in it. An account with no trips at all is not an error state, it is
// the start, so it points at the thing to do next instead of apologising.
function EmptyState({ stage, role, summary, onPickStage, onClearFilters, onFindRide, onPublishRide }) {
  const filtered = stage !== 'All' || role !== 'All';

  if (!filtered) {
    return (
      <div className="m5-card m5-blank">
        <span className="m5-blank-icon"><IconLeafSmall size={26} /></span>
        <h3>Your trips will live here</h3>
        <p>
          Every ride you host or join is kept here with its route, who came along, and the
          CO₂ it saved.
        </p>
        <div className="m5-blank-actions">
          <button className="m5-blank-primary" onClick={onFindRide}>Find a ride</button>
          <button className="m5-blank-secondary" onClick={onPublishRide}>Publish a ride</button>
        </div>
      </div>
    );
  }

  // Statuses that would actually show something, so the suggestion is never a
  // dead end.
  const alternatives = Object.entries(summary.byStatus)
    .filter(([name, count]) => count > 0 && name !== stage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="m5-card m5-blank">
      <span className="m5-blank-icon muted"><IconLeafSmall size={26} /></span>
      <h3>{stage === 'All' ? `No ${role.toLowerCase()} trips` : `No ${stage} trips`}</h3>
      <p>
        {summary.total === 0
          ? 'You have no trips recorded yet.'
          : `You have ${summary.total} trip${summary.total === 1 ? '' : 's'} under other filters.`}
      </p>

      {alternatives.length > 0 && (
        <div className="m5-blank-jump">
          <span>Jump to</span>
          {alternatives.map(([name, count]) => (
            <button key={name} className="m5-chip" onClick={() => onPickStage(name)}>
              {name} <strong>{count}</strong>
            </button>
          ))}
        </div>
      )}

      <div className="m5-blank-actions">
        <button className="m5-blank-secondary" onClick={onClearFilters}>Clear filters</button>
      </div>
    </div>
  );
}
