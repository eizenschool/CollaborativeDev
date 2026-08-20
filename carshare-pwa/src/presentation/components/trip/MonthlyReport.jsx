// ===== PRESENTATION LAYER (MonthlyReport) =====
// Module 5, Screen 4 - FR-5.8 / FR-5.9 (UC5.8, UC5.9)
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS, STATUS_COLORS } from './tripTheme.js';
import { IconChevronLeftSmall, IconChevronRightSmall, IconLeafSmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';
import ShareReportButton from './ShareReportButton.jsx';
import MonthStepper, { MONTH_NAMES } from './MonthStepper.jsx';
import StatTile from './StatTile.jsx';

export default function MonthlyReport({ userId, userName }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

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

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <MonthStepper year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
      </div>

      {state.phase === 'error' ? (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      ) : !report ? (
        <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>Loading…</p>
      ) : (
        <>
          <ShareReportButton report={report} userName={userName} />

          <div className="m5-stat-grid cols-4">
            <StatTile icon={<IconLeafSmall size={17} />} label="CO₂ saved" value={`${report.totalCarbonSavedKg} kg`} accent />
            <StatTile label="Completed trips" value={report.completedTrips} />
            <StatTile label="Distance shared" value={`${report.totalDistanceKm} km`} />
            <StatTile label="Passengers carried" value={report.passengersCarried} />
          </div>

          {!report.hasData && (
            <div className="m5-notice" role="status">
              <span className="m5-notice-icon" aria-hidden="true"><IconLeafSmall size={18} /></span>
              <p>No completed trips in {MONTH_NAMES[month]} yet. Pick another month, or check back once this one has trips.</p>
            </div>
          )}

          <p className="m5-section-title">
            Completed trips this month
            <span>{report.trips.length} {report.trips.length === 1 ? 'trip' : 'trips'}</span>
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
