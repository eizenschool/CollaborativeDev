// ===== PRESENTATION LAYER (ScoreBreakdown) =====
// Why a destination is being suggested, in that order of priority.
//
// Reasons first, in words. Nobody outside this project wants to read
// "0.88 x 0.20" - they want to know what it is about this place, and the honest
// answer is already in the numbers.
//
// The signal table stays, collapsed. It is the evidence that the scoring formula
// in the report is the one actually running, which matters to a reader marking
// this work even though it matters to nobody using the app.
import { useState } from 'react';
import {
  DESIRABILITY_WEIGHTS,
  ACCESSIBILITY_WEIGHTS,
  PRESENTATION_THRESHOLDS
} from '../../../business-logic/discovery/constants.js';
import { maxUnservedAccessibility } from '../../../business-logic/discovery/DestinationScoringEngine.js';
import { IconCheck, IconAlertTriangle, IconArrowRight } from '../icons.jsx';

const DESIRABILITY_LABELS = {
  affinity: 'Matches your travel history',
  season: 'Right time of year',
  quality: 'Rated well, by enough people',
  headroom: 'Not already overrun',
  local: 'Independently run'
};

const ACCESSIBILITY_LABELS = {
  seatHeadroom: 'Empty seats on the way',
  journeyCost: 'Close enough to reach',
  demandConvergence: 'Others want to go too'
};

function SignalRows({ signals, weights, labels, reasons = {} }) {
  return Object.entries(labels).map(([key, label]) => {
    const value = signals?.[key] ?? 0;
    const reason = reasons[key];
    return (
      <div className="dsc-signal" key={key}>
        <span>
          {label}
          {reason && <span className="dsc-signal-reason">{reason}</span>}
        </span>
        <span className="dsc-signal-bar" aria-hidden="true">
          <span className="dsc-signal-fill" style={{ width: `${Math.round(value * 100)}%` }} />
        </span>
        <span className="dsc-signal-value">
          {value.toFixed(2)} <span className="dsc-signal-weight">×{weights[key]}</span>
        </span>
      </div>
    );
  });
}

export default function ScoreBreakdown({ candidate }) {
  const [showWorking, setShowWorking] = useState(false);
  if (!candidate?.signals) return null;

  const reasons = candidate.reasons || [];
  const caveats = candidate.caveats || [];

  return (
    <div className="dsc-why">
      {reasons.length > 0 && (
        <ul className="dsc-reasons">
          {reasons.map((reason) => (
            <li key={reason.key}>
              <IconCheck size={16} /> <span>{reason.text}</span>
            </li>
          ))}
        </ul>
      )}

      {reasons.length === 0 && (
        <p className="dsc-axis-note">
          Nothing stands out about this destination for your travel date — it is
          here because it is nearby, not because it suits you particularly.
        </p>
      )}

      {caveats.length > 0 && (
        <ul className="dsc-caveats">
          {caveats.map((caveat) => (
            <li key={caveat.key}>
              <IconAlertTriangle size={16} /> <span>{caveat.text}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="dsc-working-toggle"
        onClick={() => setShowWorking((open) => !open)}
        aria-expanded={showWorking}
      >
        <IconArrowRight size={14} className={showWorking ? 'dsc-caret-open' : ''} />
        {showWorking ? 'Hide the scoring' : 'See how this was scored'}
      </button>

      {showWorking && (
        <div className="dsc-breakdown">
          <div className="dsc-breakdown-axis">
            <h3>
              How well it suits you
              <span className="dsc-axis-score">{candidate.desirability.toFixed(2)}</span>
            </h3>
            <p className="dsc-axis-note">Independent of whether anyone is driving there.</p>

            {candidate.season?.note && (
              <p className={'dsc-season-note' + (candidate.season.state === 'off-season' ? ' dsc-season-off' : '')}>
                {candidate.season.note}
              </p>
            )}

            <SignalRows
              signals={candidate.signals.desirability}
              weights={DESIRABILITY_WEIGHTS}
              labels={DESIRABILITY_LABELS}
              reasons={{ season: candidate.season?.label }}
            />
          </div>

          <div className="dsc-breakdown-axis">
            <h3>
              How easily you can get there
              <span className="dsc-axis-score">{candidate.accessibility.toFixed(2)}</span>
            </h3>
            <p className="dsc-axis-note">Independent of how appealing the place is.</p>
            <SignalRows
              signals={candidate.signals.accessibility}
              weights={ACCESSIBILITY_WEIGHTS}
              labels={ACCESSIBILITY_LABELS}
            />

            {candidate.servedByRide === false && (
              <p className="dsc-axis-cap">
                No ride serves this destination, so empty seats score 0 and this
                total cannot pass {maxUnservedAccessibility().toFixed(2)} — below the{' '}
                {PRESENTATION_THRESHOLDS.accessible.toFixed(2)} needed for the main
                list. Filling a seat that is already on the road always outranks
                creating a new journey.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
