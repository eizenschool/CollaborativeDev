// ===== PRESENTATION LAYER (Reputation) =====
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { HostImpactEngine } from '../../business-logic/HostImpactEngine.js';

export default function Reputation() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (user) HostImpactEngine.getImpactSummary(user.id).then(setSummary);
  }, [user]);

  return (
    <>
      <div className="content-header">
        <h1>Reputation</h1>
        <p>Score & public profile</p>
      </div>
      <div className="content-body">
        <div className="card">
          <p className="card-title">Public reputation score</p>
          <p className="card-subtitle">
            Shown to other riders and hosts before a Trip is confirmed. Calculated by the same
            Reputation Score Engine that feeds the Host Dashboard's Composite Impact Score.
          </p>
          {summary ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 36, fontWeight: 800, color: 'var(--teal-dark)' }}>{summary.reputationScore}</span>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>/ 100</span>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)' }}>Loading…</p>
          )}
        </div>

        <div className="card">
          <p className="card-title">Coming in later modules</p>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            Trip-by-trip rating history and dispute-adjusted reputation changes belong to Module 6
            (Trip Verification, Exchange Settlement and Safety) and aren't part of this Module 1 build.
          </p>
        </div>
      </div>
    </>
  );
}
