// ===== PRESENTATION LAYER (ImpactDashboard) =====
// Module 5, Screen 3 - FR-5.6 / FR-5.7 (UC5.6, UC5.7)
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS } from './tripTheme.js';
import { useIsDesktop } from './useIsDesktop.js';
import { IconLeafSmall, IconRoadSmall, IconUsersSmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';
import AchievementGrid from './AchievementGrid.jsx';

export default function ImpactDashboard({ userId }) {
  const isDesktop = useIsDesktop();
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    setState({ phase: 'loading' });
    TripHistoryEngine.getImpactSummary(userId)
      .then((data) => {
        if (active) setState({ phase: 'ready', summary: data });
      })
      .catch((error) => {
        if (active) setState({ phase: 'error', message: error.message });
      });
    return () => {
      active = false;
    };
  }, [userId, reloadToken]);

  if (state.phase === 'error') {
    return <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />;
  }

  if (state.phase === 'loading') {
    return <p style={{ color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>Loading your impact…</p>;
  }

  const summary = state.summary;

  const stats = [
    { icon: <IconLeafSmall size={22} />, label: 'Total Carbon Saved', value: `${summary.totalCarbonSavedKg} kg` },
    { icon: <IconRoadSmall size={22} />, label: 'Shared Travel Distance', value: `${summary.totalDistanceKm} km` },
    { icon: <IconUsersSmall size={22} />, label: 'Passengers Carried', value: summary.passengersCarried }
  ];

  return (
    <div>
      {/* A zero is a measurement, not a missing service, so the dashboard keeps
          its shape and says why the figures are still zero. Replacing the whole
          screen hid the very layout a new user is trying to understand. */}
      {!summary.hasData && (
        <div className="m5-notice" role="status">
          <span className="m5-notice-icon" aria-hidden="true"><IconLeafSmall size={18} /></span>
          <p>Nothing to count yet. These figures start moving as soon as your first shared trip is completed.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(3, 1fr)' : '1fr', gap: 16 }}>
        {stats.map((s) => (
          <div key={s.label} className="m5-stat-card" style={{ background: `linear-gradient(160deg, ${COLORS.tealTint} 0%, #FFFFFF 100%)`, border: `1px solid ${COLORS.teal}22` }}>
            <span className="m5-icon-circle" style={{ background: COLORS.teal, color: '#FFFFFF' }}>{s.icon}</span>
            <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 30, color: COLORS.teal, margin: '2px 0 0' }}>
              {s.value}
            </p>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, margin: '4px 0 0' }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="m5-card" style={{ marginTop: 16, padding: 24 }}>
        <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 15, margin: '0 0 16px', color: COLORS.textPrimary }}>
          Carbon saved trend
        </h3>
        <TrendBars points={summary.monthlyTrend} />
      </div>

      {summary.achievements && (
        <div style={{ marginTop: 16 }}>
          <AchievementGrid achievements={summary.achievements} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '14px 18px', background: COLORS.primaryTint, borderRadius: 12 }}>
        <span style={{ fontSize: 18 }}>🌱</span>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: COLORS.primaryDark, margin: 0 }}>
          {summary.treesEquivalent > 0
            ? `You've helped avoid the equivalent of planting ${summary.treesEquivalent} tree${summary.treesEquivalent === 1 ? '' : 's'}.`
            : 'Every shared seat keeps a car off the road - your first trip starts the count.'}
        </p>
      </div>
    </div>
  );
}

// Real per-month totals from TripHistoryEngine. This used to be a fixed month
// list and a made-up distribution of the all-time total, which meant the chart
// read "Aug" forever and showed figures nobody had earned.
//
// Most months are legitimately empty this early in the project, and a row of
// bare slivers read as a broken chart. Gridlines, a baseline and a per-month
// value give the empty months something to sit against, so "0 kg" reads as a
// measurement rather than a rendering failure.
const PLOT_HEIGHT = 132;

function TrendBars({ points }) {
  const peak = Math.max(...points.map((point) => point.carbonSavedKg), 0);
  const hasAnyData = peak > 0;
  // A rounded ceiling keeps the top gridline on a readable number.
  const ceiling = hasAnyData ? Math.ceil(peak / 10) * 10 || 10 : 10;
  const gridValues = [ceiling, ceiling / 2, 0];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        {/* value axis */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: PLOT_HEIGHT, paddingBottom: 1 }}>
          {gridValues.map((value) => (
            <span key={value} style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: COLORS.textSecondary, lineHeight: 1 }}>
              {value}
            </span>
          ))}
        </div>

        <div style={{ flex: 1, position: 'relative', height: PLOT_HEIGHT }}>
          {gridValues.map((value, index) => (
            <span
              key={value}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${(index / (gridValues.length - 1)) * 100}%`,
                borderTop: `1px ${index === gridValues.length - 1 ? 'solid' : 'dashed'} ${COLORS.border}`
              }}
            />
          ))}

          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            {points.map((point) => {
              const filled = point.carbonSavedKg > 0;
              return (
                <div key={`${point.year}-${point.month}`} style={{ flex: 1, textAlign: 'center' }}>
                  {filled && (
                    <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 11, fontWeight: 700, color: COLORS.teal, margin: '0 0 4px' }}>
                      {point.carbonSavedKg}
                    </p>
                  )}
                  <div
                    title={`${point.label}: ${point.carbonSavedKg} kg CO₂`}
                    style={{
                      height: filled ? Math.max(6, (point.carbonSavedKg / ceiling) * (PLOT_HEIGHT - 22)) : 3,
                      background: filled
                        ? `linear-gradient(180deg, ${COLORS.teal} 0%, ${COLORS.primary} 100%)`
                        : COLORS.border,
                      borderRadius: filled ? '6px 6px 2px 2px' : 2
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingLeft: 28 }}>
        {points.map((point) => (
          <p
            key={`${point.year}-${point.month}`}
            style={{
              flex: 1,
              textAlign: 'center',
              fontFamily: 'Inter, sans-serif',
              fontSize: 11,
              fontWeight: point.carbonSavedKg > 0 ? 700 : 500,
              color: point.carbonSavedKg > 0 ? COLORS.textPrimary : COLORS.textSecondary,
              margin: 0
            }}
          >
            {point.label}
          </p>
        ))}
      </div>

      {!hasAnyData && (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '12px 0 0', textAlign: 'center' }}>
          No completed trips in the last six months yet.
        </p>
      )}
    </div>
  );
}