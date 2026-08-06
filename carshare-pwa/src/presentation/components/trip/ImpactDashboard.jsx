// ===== PRESENTATION LAYER (ImpactDashboard) =====
// Module 5, Screen 3 - FR-5.6 / FR-5.7 (UC5.6, UC5.7)
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS } from './tripTheme.js';
import { useIsDesktop } from './useIsDesktop.js';
import { IconLeafSmall, IconRoadSmall, IconUsersSmall } from './tripIcons.jsx';

export default function ImpactDashboard({ userId }) {
  const isDesktop = useIsDesktop();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    TripHistoryEngine.getImpactSummary(userId).then((data) => {
      if (active) setSummary(data);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  if (!summary) {
    return <p style={{ color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>Loading your impact…</p>;
  }

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
        <TrendBars totalKg={summary.totalCarbonSavedKg} />
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

function TrendBars({ totalKg }) {
  // Illustrative distribution of the total across recent months, for visual
  // context only - real per-month figures live in Monthly Report.
  const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const weights = [0.08, 0.12, 0.15, 0.18, 0.22, 0.25];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 130 }}>
      {months.map((m, i) => (
        <div key={m} style={{ flex: 1, textAlign: 'center' }}>
          <div
            style={{
              height: Math.max(10, totalKg * weights[i]),
              maxHeight: 100,
              background: `linear-gradient(180deg, ${COLORS.teal} 0%, ${COLORS.primary} 100%)`,
              borderRadius: '8px 8px 4px 4px'
            }}
          />
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, margin: '6px 0 0' }}>{m}</p>
        </div>
      ))}
    </div>
  );
}