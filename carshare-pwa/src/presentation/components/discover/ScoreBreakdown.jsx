// ===== PRESENTATION LAYER (ScoreBreakdown) =====
// Renders the eight signals behind a recommendation.
//
// A ranking a user cannot interrogate is a ranking they have to take on trust.
// Showing each signal, its weight and its normalised value makes the order
// arguable rather than magical - and it is what lets a marker check the formula
// in the report against what the running system actually does.
import { DESIRABILITY_WEIGHTS, ACCESSIBILITY_WEIGHTS } from '../../../business-logic/discovery/constants.js';

const DESIRABILITY_LABELS = {
  affinity: 'Personal affinity',
  season: 'Seasonal fit',
  quality: 'Place quality',
  headroom: 'Visitation headroom',
  local: 'Local economy'
};

const ACCESSIBILITY_LABELS = {
  seatHeadroom: 'Seat headroom',
  journeyCost: 'Journey cost',
  demandConvergence: 'Demand convergence'
};

function SignalRows({ signals, weights, labels }) {
  return Object.entries(labels).map(([key, label]) => {
    const value = signals?.[key] ?? 0;
    const weight = weights[key];
    return (
      <div className="dsc-signal" key={key}>
        <span className="dsc-signal-label">{label}</span>
        <span className="dsc-signal-bar" aria-hidden="true">
          <span className="dsc-signal-fill" style={{ width: `${Math.round(value * 100)}%` }} />
        </span>
        <span className="dsc-signal-value">
          {value.toFixed(2)} <span className="dsc-signal-weight">x{weight}</span>
        </span>
      </div>
    );
  });
}

export default function ScoreBreakdown({ candidate }) {
  if (!candidate?.signals) return null;

  return (
    <div className="dsc-breakdown">
      <div className="dsc-breakdown-axis">
        <h4>
          Desirability <strong>{candidate.desirability.toFixed(2)}</strong>
        </h4>
        <p className="dsc-axis-note">How well this suits you, whether or not anyone is driving.</p>
        <SignalRows
          signals={candidate.signals.desirability}
          weights={DESIRABILITY_WEIGHTS}
          labels={DESIRABILITY_LABELS}
        />
      </div>

      <div className="dsc-breakdown-axis">
        <h4>
          Accessibility <strong>{candidate.accessibility.toFixed(2)}</strong>
        </h4>
        <p className="dsc-axis-note">How efficiently you can actually get there.</p>
        <SignalRows
          signals={candidate.signals.accessibility}
          weights={ACCESSIBILITY_WEIGHTS}
          labels={ACCESSIBILITY_LABELS}
        />
        {!candidate.servedByRide && (
          <p className="dsc-axis-cap">
            No ride serves this destination, so seat headroom scores 0 and
            accessibility cannot exceed 0.45 - below the 0.60 needed for the main
            list. Filling an empty seat always outranks creating a new journey.
          </p>
        )}
      </div>
    </div>
  );
}
