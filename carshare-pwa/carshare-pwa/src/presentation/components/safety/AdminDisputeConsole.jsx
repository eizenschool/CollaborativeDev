// ===== PRESENTATION LAYER (AdminDisputeConsole) =====
// UC6.10 RESOLVE DISPUTE. Backs the System Administrator actor from the proposal's
// Viewpoint-Oriented Analysis - "the final arbiter for contested outcomes". Only
// ever shows trips UC6.9 routed here for a confidence score below the auto-resolve
// threshold; everything above it never reaches a human.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DisputeResolutionService } from '../../../business-logic/verification/DisputeResolutionService.js';
import { TripContractAdapter } from '../../../business-logic/verification/TripContractAdapter.js';
import { DISPUTE_OUTCOME } from '../../../business-logic/verification/constants.js';
import DisputeEvidenceCard from './DisputeEvidenceCard.jsx';
import { IconArrowLeft, IconShield } from '../icons.jsx';

export default function AdminDisputeConsole() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [resolvingId, setResolvingId] = useState(null);

  const load = useCallback(async () => {
    const pending = await DisputeResolutionService.listPendingReview();
    const withRides = await Promise.all(
      pending.map(async (verification) => ({
        verification,
        ride: await TripContractAdapter.getRideSnapshot(verification.rideId)
      }))
    );
    setRows(withRides);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(rideId, outcome) {
    setError('');
    setResolvingId(rideId);
    try {
      await DisputeResolutionService.resolveDispute(rideId, outcome, 'admin-demo');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="safety-page">
      <Link to="/safety" className="safety-back-link"><IconArrowLeft size={14} /> Back to Safety Centre</Link>

      <div className="safety-page-head">
        <div>
          <h2><IconShield size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Admin dispute console</h2>
          <p>Trips a low-confidence score routed to manual review (UC6.9 → UC6.10).</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {rows === null && <p>Loading…</p>}

      {rows && rows.length === 0 && (
        <div className="admin-queue-empty">No disputes are waiting on manual review right now.</div>
      )}

      {rows && rows.map(({ verification, ride }) => (
        <div className="admin-dispute-card" key={verification.rideId}>
          <div className="admin-dispute-head">
            <div>
              <strong>{ride?.pickup || 'Unknown'}</strong>
              <span style={{ color: 'var(--muted)' }}> → {ride?.destination || 'Unknown'}</span>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Host: {ride?.host?.fullName || verification.hostId}
              </div>
            </div>
          </div>

          <DisputeEvidenceCard dispute={verification.dispute} />

          <div className="admin-resolve-row">
            <button
              type="button"
              className="resolve-fulfilled"
              disabled={resolvingId === verification.rideId}
              onClick={() => resolve(verification.rideId, DISPUTE_OUTCOME.FULFILLED)}
            >
              Fulfilled
            </button>
            <button
              type="button"
              className="resolve-not-fulfilled"
              disabled={resolvingId === verification.rideId}
              onClick={() => resolve(verification.rideId, DISPUTE_OUTCOME.NOT_FULFILLED)}
            >
              Not Fulfilled
            </button>
            <button
              type="button"
              className="resolve-inconclusive"
              disabled={resolvingId === verification.rideId}
              onClick={() => resolve(verification.rideId, DISPUTE_OUTCOME.INCONCLUSIVE)}
            >
              Inconclusive
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
