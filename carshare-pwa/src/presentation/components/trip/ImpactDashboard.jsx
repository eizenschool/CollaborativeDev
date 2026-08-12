// ===== PRESENTATION LAYER (ImpactDashboard) =====
// Module 5, Screen 3 - FR-5.6 / FR-5.7 (UC5.6, UC5.7)
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS } from './tripTheme.js';
import { useIsDesktop } from './useIsDesktop.js';
import { IconLeafSmall, IconRoadSmall, IconUsersSmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';

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

  if (!summary.hasData) {
    return (
      <div className="m5-card m5-empty">
        <span className="m5-icon-circle" style={{ background: COLORS.tealTint, color: COLORS.teal, width: 52, height: 52 }}>
          <IconLeafSmall size={22} />
        </span>
        <p style={{ fontFamily: 'Inter, sans-serif', color: COLORS.textSecondary, marginTop: 4, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
          Environmental impact statistics are not available yet — complete your first ride to start tracking your
          impact.
        </p>
      </div>
    );
  }

  const stats = [
    { icon: <IconLeafSmall size={22} />, label: 'Total Carbon Saved', value: `${summary.totalCarbonSavedKg} kg` },
    { icon: <IconRoadSmall size={22} />, label: 'Shared Travel Distance', value: `${summary.totalDistanceKm} km` },
    { icon: <IconUsersSmall size={22} />, label: 'Passengers Carried', value: summary.passengersCarried }
  ];

  return (
    <div>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '14px 18px', background: COLORS.primaryTint, borderRadius: 12 }}>
        <span style={{ fontSize: 18 }}>🌱</span>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: COLORS.primaryDark, margin: 0 }}>
          You've helped avoid the equivalent of planting {summary.treesEquivalent} trees.
        </p>
      </div>
    </div>
  );
}

// Real per-month totals from TripHistoryEngine. This used to be a fixed month
// list and a made-up distribution of the all-time total, which meant the chart
// read "Aug" forever and showed figures nobody had earned.
function TrendBars({ points }) {
  const peak = Math.max(...points.map((point) => point.carbonSavedKg), 0);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 130 }}>
      {points.map((point) => (
        <div key={`${point.year}-${point.month}`} style={{ flex: 1, textAlign: 'center' }}>
          <div
            title={`${point.carbonSavedKg} kg CO₂`}
            style={{
              // Zero months stay a visible baseline sliver so the axis reads as
              // "no trips that month" rather than a rendering gap.
              height: peak > 0 ? Math.max(4, (point.carbonSavedKg / peak) * 100) : 4,
              background:
                point.carbonSavedKg > 0
                  ? `linear-gradient(180deg, ${COLORS.teal} 0%, ${COLORS.primary} 100%)`
                  : COLORS.border,
              borderRadius: '8px 8px 4px 4px'
            }}
          />
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, margin: '6px 0 0' }}>
            {point.label}
          </p>
        </div>
      ))}
    </div>
  );
}