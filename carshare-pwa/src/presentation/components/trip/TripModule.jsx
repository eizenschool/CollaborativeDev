// ===== PRESENTATION LAYER (TripModule) =====
// Module 5 - Trip Management & Eco Impact. Entry point reached from Profile
// ("My Impact & Trip History"). Holds the shared hero header + the History /
// Impact / Monthly Report / Leaderboard segmented control - switching tabs
// here is local state, not a route change. Tapping a trip card in History
// pushes to /trip/:tripId (TripDetail.jsx).
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import RideHistory from './RideHistory.jsx';
import ImpactDashboard from './ImpactDashboard.jsx';
import MonthlyReport from './MonthlyReport.jsx';
import Leaderboard from './Leaderboard.jsx';
import { IconLeafSmall } from './tripIcons.jsx';
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
  const tabRefs = useRef([]);

  // A tablist is expected to move between tabs with the arrow keys - without
  // this the four panels are reachable by pointer only. Follows the same roles
  // as Module 2's RideHub tabs (ride/RideHub.jsx) and adds the key handling.
  function handleTabKeyDown(event, index) {
    const last = TABS.length - 1;
    let next = null;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="m5-root">
      <header className="m5-hero">
        <span className="m5-hero-icon" aria-hidden="true"><IconLeafSmall size={25} /></span>
        <div>
          <p>YOUR JOURNEYS</p>
          <h1>My Trips &amp; Impact</h1>
          <small>Your ride history and environmental impact, all in one place</small>
        </div>
      </header>

      <div className="m5-tabs" role="tablist" aria-label="Trips and impact">
        {TABS.map((t, index) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              role="tab"
              id={`m5-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`m5-panel-${t.id}`}
              // Roving tabindex: one stop for the whole tablist, then arrows.
              tabIndex={active ? 0 : -1}
              className={'m5-tab' + (active ? ' active' : '')}
              onClick={() => setTab(t.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="m5-content">
        <div
          className="m5-page"
          role="tabpanel"
          id={`m5-panel-${tab}`}
          aria-labelledby={`m5-tab-${tab}`}
        >
          {tab === 'history' && <RideHistory userId={user?.id} onOpenTrip={(id) => navigate(`/trip/${id}`)} />}
          {tab === 'impact' && <ImpactDashboard userId={user?.id} />}
          {tab === 'report' && <MonthlyReport userId={user?.id} userName={user?.fullName} />}
          {tab === 'leaderboard' && <Leaderboard userId={user?.id} />}
        </div>
      </div>
    </div>
  );
}