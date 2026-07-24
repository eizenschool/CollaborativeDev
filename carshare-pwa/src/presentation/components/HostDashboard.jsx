// ===== PRESENTATION LAYER (HostDashboard) =====
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { HostImpactEngine } from '../../business-logic/HostImpactEngine.js';
import { isSupabaseConfigured } from '../../data-access/supabaseClient.js';

export default function HostDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  async function refresh() {
    setSummary(await HostImpactEngine.getImpactSummary(user.id));
  }

  async function adjust(trips, reputation) {
    setSummary(await HostImpactEngine.applyDemoAdjustment(user.id, { trips, reputation }));
  }

  if (!summary) return <div className="content-body"><p style={{ color: 'var(--muted)' }}>Loading…</p></div>;

  const maxForBar = summary.nextTier ? summary.nextTier.minScore : summary.compositeScore * 1.2;
  const pct = Math.min(100, Math.round((summary.compositeScore / maxForBar) * 100));

  return (
    <>
      <div className="content-header">
        <h1>Host Dashboard</h1>
        <p>Your impact score, badge tier, and ride publishing</p>
      </div>
      <div className="content-body">
        <button className="btn-primary" style={{ marginBottom: 16 }} onClick={() => alert('Publish New Ride belongs to Module 4/5 - out of scope for this Module 1 build.')}>
          🚗 Publish New Ride
        </button>

        <div className="card">
          <div className="impact-header">
            <div className="impact-badge">🏅 {summary.badge.name}</div>
            <div className="impact-owner">{user?.fullName || user?.user_metadata?.full_name}</div>
          </div>

          <p className="card-title" style={{ marginTop: 4 }}>Active perks</p>
          <ul className="perk-list">
            {summary.badge.perks.map((p) => (
              <li key={p}><span className="perk-check">✓</span>{p}</li>
            ))}
          </ul>

          {!isSupabaseConfigured && (
            <div className="demo-controls" style={{ marginTop: 18 }}>
              <p className="card-title">Demo controls</p>
              <button className="btn-block demo-up" onClick={() => adjust(5, 3)}>↗ +5 trips, +3 rep score</button>
              <button className="btn-block demo-down" onClick={() => adjust(-8, -12)}>↘ −8 trips, −12 rep score</button>
              <button className="demo-reset" onClick={() => alert('Clear localStorage (key: letstumpang_mock_db_v1) to reset all demo data.')}>Reset to defaults</button>
            </div>
          )}
        </div>

        <div className="card">
          <p className="card-title">⚡ Impact Score Formula</p>

          <div className="formula-row">
            <span className="formula-icon">🚗</span>
            <div>
              <div className="formula-value">{summary.completedTrips}</div>
              <div className="formula-label">Completed Trips</div>
            </div>
            <span className="formula-weight">× {summary.weights.trips.toFixed(1)}</span>
          </div>

          <div className="formula-row">
            <span className="formula-icon">🍃</span>
            <div>
              <div className="formula-value">{summary.co2SavedKg}</div>
              <div className="formula-label">CO₂ Saved (kg)</div>
            </div>
            <span className="formula-weight">× {summary.weights.co2.toFixed(1)}</span>
          </div>

          <div className="formula-row">
            <span className="formula-icon">⭐</span>
            <div>
              <div className="formula-value">{summary.reputationScore}</div>
              <div className="formula-label">Reputation Score</div>
            </div>
            <span className="formula-weight">× {summary.weights.reputation.toFixed(1)}</span>
          </div>

          <div className="composite-bar">
            <p className="card-title" style={{ marginBottom: 0 }}>Composite Impact Score</p>
            <div className="composite-track"><div className="composite-fill" style={{ width: pct + '%' }} /></div>
            <div className="composite-label">
              <span>{summary.compositeScore}</span>
              <span>{summary.nextTier ? `${summary.nextTier.pointsToNext} pts to ${summary.nextTier.name}` : 'Top tier reached'}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
