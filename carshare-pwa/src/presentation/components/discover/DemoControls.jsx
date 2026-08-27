// ===== PRESENTATION LAYER (DemoControls) =====
// Reachable only at ?demo=1, so it does not exist during ordinary use.
//
// Two rules in this module are hard to show on demand. Seasonal weighting needs
// a date months away, and the weather gate's withholding path needs a severe
// warning that Malaysian weather is unlikely to supply while anyone is watching.
// Both are real rules with real consequences; this only changes the inputs they
// are given.
import { useEffect, useState } from 'react';
import {
  DiscoveryDemoControls,
  WEATHER_OVERRIDES
} from '../../../business-logic/discovery/DiscoveryDemoControls.js';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { IconCalendar, IconAlertTriangle, IconX, IconBell } from '../icons.jsx';

const LIFECYCLE_ACTIONS = [
  { state: 'Stale', label: 'Mark Stale' },
  { state: 'Retired', label: 'Mark Retired' },
  { state: 'Active', label: 'Restore Active' }
];

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

// FR-6.33's registration is also the narrow set of places 076's RPC allows
// this user to change - reusing it means the picker only ever offers places
// the toggle can actually act on.
function PlaceStatusDemo({ userId }) {
  const [places, setPlaces] = useState([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const registrations = await DestinationDiscoveryService.listRegistrations(userId);
      const active = registrations.filter((r) => r.status === 'active');
      const withNames = await Promise.all(active.map(async (r) => {
        const place = await DestinationDiscoveryService.getPlace(r.placeId);
        return place ? { placeId: r.placeId, name: place.name } : null;
      }));
      if (!cancelled) {
        const resolved = withNames.filter(Boolean);
        setPlaces(resolved);
        setSelectedPlaceId((current) => current || resolved[0]?.placeId || '');
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const applyState = async (state) => {
    if (!selectedPlaceId) return;
    setBusy(true);
    setMessage(null);
    try {
      await DestinationDiscoveryService.setPlaceLifecycleState(selectedPlaceId, state);
      setMessage({ tone: 'ok', text: `Done - check the notification bell for whoever is watching this place.` });
    } catch (cause) {
      setMessage({ tone: 'error', text: cause.message });
    } finally {
      setBusy(false);
    }
  };

  if (!userId) {
    return (
      <div className="dsc-demo-group">
        <h3><IconBell size={14} /> Place status</h3>
        <p className="dsc-demo-hint">Sign in and register for a ride notification (UC6.12) to try this.</p>
      </div>
    );
  }

  return (
    <div className="dsc-demo-group">
      <h3><IconBell size={14} /> Place status</h3>
      <p className="dsc-demo-hint">
        Fires 075's real notification trigger against the place you have registered
        for - not a simulated input, an actual database write.
      </p>
      {places.length === 0 ? (
        <p className="dsc-demo-hint">
          Register for a ride notification (UC6.12) on a destination first, then come back here.
        </p>
      ) : (
        <>
          <select
            className="dsc-demo-place-select"
            value={selectedPlaceId}
            onChange={(event) => setSelectedPlaceId(event.target.value)}
          >
            {places.map((p) => (
              <option key={p.placeId} value={p.placeId}>{p.name}</option>
            ))}
          </select>
          <div className="dsc-demo-months">
            {LIFECYCLE_ACTIONS.map(({ state, label }) => (
              <button
                key={state}
                type="button"
                className="dsc-demo-chip"
                disabled={busy}
                onClick={() => applyState(state)}
              >
                {label}
              </button>
            ))}
          </div>
          {message && (
            <p className={'dsc-demo-hint' + (message.tone === 'error' ? ' dsc-demo-error' : '')}>
              {message.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function DemoControls({ travelDate, onTravelDateChange, onChanged, userId }) {
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

      <PlaceStatusDemo userId={userId} />
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
