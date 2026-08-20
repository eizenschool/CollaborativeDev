// ===== PRESENTATION LAYER (MonthlyReport) =====
// Module 5, Screen 4 - FR-5.8 / FR-5.9 (UC5.8, UC5.9)
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS, STATUS_COLORS } from './tripTheme.js';
import { IconChevronLeftSmall, IconChevronRightSmall, IconLeafSmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';
import ShareReportButton from './ShareReportButton.jsx';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function MonthlyReport({ userId, userName }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  // UC5.8 C2 - reports cover completed trips, so there is nothing to report on
  // a month that has not happened yet.
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  useEffect(() => {
    let active = true;
    if (!userId) return;
    setState({ phase: 'loading' });
    TripHistoryEngine.getMonthlyReport(userId, year, month)
      .then((data) => {
        if (active) setState({ phase: 'ready', report: data });
      })
      .catch((error) => {
        if (active) setState({ phase: 'error', message: error.message });
      });
    return () => {
      active = false;
    };
  }, [userId, year, month, reloadToken]);

  const report = state.phase === 'ready' ? state.report : null;

  function shiftMonth(delta) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    if (new Date(y, m, 1) > new Date(now.getFullYear(), now.getMonth(), 1)) return;
    setMonth(m);
    setYear(y);
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 24 }}>
        <button onClick={() => shiftMonth(-1)} className="m5-icon-btn" aria-label="Previous month">
          <IconChevronLeftSmall size={18} />
        </button>
        <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 17, margin: 0, minWidth: 170, textAlign: 'center', color: COLORS.textPrimary }}>
          {MONTH_NAMES[month]} {year}
        </p>
        <button
          onClick={() => shiftMonth(1)}
          className="m5-icon-btn"
          disabled={isCurrentMonth}
          aria-label="Next month"
          style={{ opacity: isCurrentMonth ? 0.4 : 1, cursor: isCurrentMonth ? 'not-allowed' : 'pointer' }}
        >
          <IconChevronRightSmall size={18} />
        </button>
      </div>

      {state.phase === 'error' ? (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      ) : !report ? (
        <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>Loading…</p>
      ) : (
        <>
          <ShareReportButton report={report} userName={userName} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
            <SummaryStat label="Completed Trips" value={report.completedTrips} />
            <SummaryStat label="Distance Shared" value={`${report.totalDistanceKm} km`} />
            <SummaryStat label="Passengers Carried" value={report.passengersCarried} />
            <SummaryStat label="CO₂ Saved" value={`${report.totalCarbonSavedKg} kg`} icon />
          </div>

          {!report.hasData && (
            <div className="m5-notice" role="status">
              <span className="m5-notice-icon" aria-hidden="true"><IconLeafSmall size={18} /></span>
              <p>No completed trips in {MONTH_NAMES[month]} yet. Pick another month, or check back once this one has trips.</p>
            </div>
          )}

          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: COLORS.textSecondary, margin: '0 0 10px' }}>
            Completed trips this month
          </p>
          <div>
            {report.trips.length === 0 && (
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: COLORS.textSecondary, margin: 0, padding: '18px 4px' }}>
                Nothing recorded for this month.
              </p>
            )}
            {report.trips.map((trip) => {
              const palette = STATUS_COLORS[trip.status] || STATUS_COLORS.Completed;
              return (
                <div key={trip.id} className="m5-card" style={{ padding: 16, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 14, margin: 0, color: COLORS.textPrimary }}>
                      {trip.pickup} → {trip.destination}
                    </p>
                    <span style={{ fontSize: 11, fontWeight: 700, color: palette.text, background: palette.bg, padding: '3px 10px', borderRadius: 999, flexShrink: 0 }}>
                      {trip.status}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '6px 0 0' }}>{trip.date}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value, icon }) {
  return (
    <div
      className="m5-card"
      style={{
        padding: 18,
        textAlign: 'center',
        background: icon ? `linear-gradient(160deg, ${COLORS.tealTint} 0%, #FFFFFF 100%)` : COLORS.surface
      }}
    >
      {icon && (
        <span className="m5-icon-circle" style={{ background: COLORS.teal, color: '#FFFFFF', width: 36, height: 36, marginBottom: 8 }}>
          <IconLeafSmall size={16} />
        </span>
      )}
      <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 24, color: icon ? COLORS.teal : COLORS.textPrimary, margin: 0 }}>
        {value}
      </p>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '4px 0 0' }}>{label}</p>
    </div>
  );
}