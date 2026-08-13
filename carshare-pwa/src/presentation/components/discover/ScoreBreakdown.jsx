// ===== PRESENTATION LAYER (ScoreBreakdown) =====
// The eight signals behind a recommendation, shown on the detail screen.
//
// A ranking a user cannot interrogate is one they have to take on trust. Showing
// each signal, its weight and its normalised value makes the order arguable
// rather than magical - and it is what lets a reader check the formula in the
// report against what the running system actually does.
import {
  DESIRABILITY_WEIGHTS,
  ACCESSIBILITY_WEIGHTS,
  PRESENTATION_THRESHOLDS
} from '../../../business-logic/discovery/constants.js';
import { maxUnservedAccessibility } from '../../../business-logic/discovery/DestinationScoringEngine.js';

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

function SignalRows({ signals, weights, labels }) {
  return Object.entries(labels).map(([key, label]) => {
    const value = signals?.[key] ?? 0;
    return (
      <div className="dsc-signal" key={key}>
        <span>{label}</span>
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
  if (!candidate?.signals) return null;

  return (
    <div className="dsc-breakdown">
      <div className="dsc-breakdown-axis">
        <h3>
          How well it suits you
          <span className="dsc-axis-score">{candidate.desirability.toFixed(2)}</span>
        </h3>
        <p className="dsc-axis-note">Independent of whether anyone is driving there.</p>
        <SignalRows
          signals={candidate.signals.desirability}
          weights={DESIRABILITY_WEIGHTS}
          labels={DESIRABILITY_LABELS}
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
            No ride serves this destination, so empty seats score 0 and this total
            cannot pass {maxUnservedAccessibility().toFixed(2)} — below the{' '}
            {PRESENTATION_THRESHOLDS.accessible.toFixed(2)} needed for the main list.
            Filling a seat that is already on the road always outranks creating a
            new journey.
          </p>
        )}
      </div>
    </div>
  );
}
