// ===== PRESENTATION LAYER (TripModule) =====
// Module 5 - Trip Management & Eco Impact. Entry point reached from Profile
// ("My Impact & Trip History"). Holds the shared hero header + the History /
// Impact / Monthly Report / Leaderboard segmented control - switching tabs
// here is local state, not a route change. Tapping a trip card in History
// pushes to /trip/:tripId (TripDetail.jsx).
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import RideHistory from './RideHistory.jsx';
import ImpactDashboard from './ImpactDashboard.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import Leaderboard from './Leaderboard.jsx';
import { IconArrowLeftSmall, IconLeafSmall } from './tripIcons.jsx';
import { COLORS } from './tripTheme.js';
import './tripStyles.css';

const TABS = [
  { id: 'history', label: 'History' },
  { id: 'impact', label: 'Impact' },
  { id: 'report', label: 'Monthly Report' },
  { id: 'leaderboard', label: 'Leaderboard' }
];

export default function TripModule() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('history');

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg }}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          padding: '32px 24px',
          background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.teal} 100%)`
        }}
      >
        {/* decorative background circles, purely cosmetic */}
        <div style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -70, right: 120, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />

        <div style={{ position: 'relative', maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => navigate('/profile')}
            aria-label="Back to Profile"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#FFFFFF',
              flexShrink: 0,
              backdropFilter: 'blur(4px)'
            }}
          >
            <IconArrowLeftSmall size={18} />
          </button>

          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              flexShrink: 0,
              backdropFilter: 'blur(4px)'
            }}
          >
            <IconLeafSmall size={26} />
          </span>

          <div>
            <h1 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 28, margin: 0, color: '#FFFFFF', letterSpacing: -0.3 }}>
              My Trips &amp; Impact
            </h1>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(255,255,255,0.85)', margin: '4px 0 0' }}>
              Your ride history and environmental impact, all in one place
            </p>
          </div>
        </div>
      </div>

      <div className="m5-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={'m5-tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="m5-content">
        <div className="m5-page">
          {tab === 'history' && <RideHistory userId={user?.id} onOpenTrip={(id) => navigate(`/trip/${id}`)} />}
          {tab === 'impact' && <ImpactDashboard userId={user?.id} />}
          {tab === 'report' && <MonthlyReport userId={user?.id} />}
          {tab === 'leaderboard' && <Leaderboard userId={user?.id} />}
        </div>
      </div>
    </div>
  );
}