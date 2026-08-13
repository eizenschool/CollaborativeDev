// ===== PRESENTATION LAYER (DemoControls) =====
// Reachable only at ?demo=1, so it does not exist during ordinary use.
//
// Two rules in this module are hard to show on demand. Seasonal weighting needs
// a date months away, and the weather gate's withholding path needs a severe
// warning that Malaysian weather is unlikely to supply while anyone is watching.
// Both are real rules with real consequences; this only changes the inputs they
// are given.
import { useState } from 'react';
import {
  DiscoveryDemoControls,
  WEATHER_OVERRIDES
} from '../../../business-logic/discovery/DiscoveryDemoControls.js';
import { IconCalendar, IconAlertTriangle, IconX } from '../icons.jsx';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const WEATHER_LABELS = {
  clear: 'Clear',
  advisory: 'Heavy rain',
  severe: 'Severe warning'
};

const WEATHER_HINTS = {
  clear: 'No advisory anywhere.',
  advisory: 'Outdoor places stay listed, each carrying a warning.',
  severe: 'Outdoor places are withheld entirely; indoor ones keep an advisory for the journey.'
};

export default function DemoControls({ travelDate, onTravelDateChange, onChanged }) {
  const [weather, setWeather] = useState(() => DiscoveryDemoControls.getWeatherOverride());

  const applyWeather = (mode) => {
    const next = weather === mode ? null : mode;
    DiscoveryDemoControls.setWeatherOverride(next);
    setWeather(next);
    onChanged?.();
  };

  const reset = () => {
    DiscoveryDemoControls.resetDemo();
    setWeather(null);
    onChanged?.();
  };

  const activeMonth = Number(travelDate?.slice(5, 7));

  return (
    <section className="dsc-demo" aria-label="Demonstration controls">
      <div className="dsc-demo-head">
        <h2>Demonstration controls</h2>
        <button type="button" className="dsc-btn dsc-btn-ghost" onClick={reset}>
          <IconX size={14} /> Reset
        </button>
      </div>
      <p className="dsc-demo-note">
        Only the inputs are simulated. The seasonal calendar and the weather gate
        run exactly as they do in normal use.
      </p>

      <div className="dsc-demo-group">
        <h3><IconCalendar size={14} /> Travel month</h3>
        <div className="dsc-demo-months">
          {MONTHS.map((label, index) => {
            const month = index + 1;
            return (
              <button
                key={label}
                type="button"
                className={'dsc-demo-chip' + (activeMonth === month ? ' active' : '')}
                onClick={() => onTravelDateChange(DiscoveryDemoControls.dateForMonth(month))}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="dsc-demo-hint">
          Try <strong>Dec</strong> for the north-east monsoon, <strong>Jul</strong> for
          the highland dry months and durian season.
        </p>
      </div>

      <div className="dsc-demo-group">
        <h3><IconAlertTriangle size={14} /> Weather</h3>
        <div className="dsc-demo-months">
          {WEATHER_OVERRIDES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={'dsc-demo-chip' + (weather === mode ? ' active' : '')}
              onClick={() => applyWeather(mode)}
              aria-pressed={weather === mode}
            >
              {WEATHER_LABELS[mode]}
            </button>
          ))}
        </div>
        <p className="dsc-demo-hint">
          {weather ? WEATHER_HINTS[weather] : 'Using the real forecast from Open-Meteo.'}
        </p>
      </div>
    </section>
  );
}

/**
 * Shown wherever a simulation is running, on every screen rather than only the
 * one holding the controls. Demonstrating a withheld destination and forgetting
 * to say the weather was simulated would misrepresent the system.
 */
export function DemoActiveBanner() {
  if (!DiscoveryDemoControls.isDemoActive()) return null;
  return (
    <p className="dsc-demo-banner" role="status">
      <IconAlertTriangle size={14} />
      Simulated weather is active — these results are not based on the real forecast.
    </p>
  );
}
