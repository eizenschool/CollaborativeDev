// ===== PRESENTATION LAYER (DisputeEvidenceCard) =====
// Renders the confidence score's four-signal breakdown so the number an admin acts
// on (UC6.10) is auditable rather than a black box - each axis is shown at its own
// weight and normalised value, the same shape DisputeConfidenceEngine.scoreDispute
// returns.
import { DisputeConfidenceEngine } from '../../../business-logic/verification/DisputeConfidenceEngine.js';
import { IconMapPin, IconMedal, IconCalendar, IconAlertTriangle } from '../icons.jsx';

const SIGNAL_META = [
  { key: 'gps', label: 'GPS match', Icon: IconMapPin },
  { key: 'reputation', label: 'Reputation', Icon: IconMedal },
  { key: 'timestamp', label: 'Timing', Icon: IconCalendar },
  { key: 'history', label: 'History', Icon: IconAlertTriangle }
];

export default function DisputeEvidenceCard({ dispute }) {
  if (!dispute || dispute.confidenceScore == null) return null;

  const weights = dispute.weights || DisputeConfidenceEngine.weights;
  const signals = dispute.signals || {};

  return (
    <div className="card">
      <div className="card-title">Verification confidence score</div>
      <div className="card-subtitle">
        Weighted from GPS cross-check, confirmation timing, reputation, and dispute history (UC6.8)
      </div>

      <div className="evidence-score-row">
        <div>
          <div className="evidence-score-value">{dispute.confidenceScore.toFixed(2)}</div>
          <div className="evidence-score-label">of 1.00</div>
        </div>
        <span className={'status-pill status-' + (dispute.status || '').toLowerCase().replace(/\s+/g, '-')}>
          {dispute.status}
        </span>
      </div>

      {SIGNAL_META.map(({ key, label, Icon }) => {
        const value = signals[key] ?? 0;
        return (
          <div className="signal-row" key={key}>
            <span className="signal-name"><Icon size={13} /> {label}</span>
            <div className="signal-track">
              <div className={'signal-fill' + (value === 0 ? ' zero' : '')} style={{ width: `${value * 100}%` }} />
            </div>
            <span className="signal-weight">×{(weights[key] * 100).toFixed(0)}%</span>
          </div>
        );
      })}

      {dispute.outcome && (
        <div className="exchange-result-row" style={{ marginTop: 10 }}>
          <span>Outcome</span>
          <strong>{dispute.outcome}</strong>
        </div>
      )}
    </div>
  );
}
