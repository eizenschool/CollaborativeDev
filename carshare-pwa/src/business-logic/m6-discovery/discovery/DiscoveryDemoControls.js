// ===== BUSINESS LOGIC LAYER (DiscoveryDemoControls) =====
// A demonstration affordance for the two rules that cannot otherwise be shown.
//
// Seasonal weighting is already reachable through the date picker, but weather
// is not: FR-6.22's withholding path only fires under a severe warning, and
// Malaysian weather during any given demo will almost certainly be clear or
// lightly wet. Without an override the most defensible safety rule in the module
// is invisible.
//
// Same shape as the project's existing DemoClockService: this supplies a value,
// and the rules that consume it are untouched. `applyWeatherGate` cannot tell an
// overridden forecast from a real one, which is the point - what is being
// demonstrated is the real rule, not a mock of it.
//
// Module-level state rather than React state, so an override survives navigation
// between the hub, the detail screen and the demand view.

// WMO codes chosen to land in each branch of classifyForecast().
const OVERRIDE_CODES = {
  clear: 0,      // Clear sky
  advisory: 65,  // Heavy rain - adverse, not severe
  severe: 99     // Thunderstorm with heavy hail
};

export const WEATHER_OVERRIDES = Object.keys(OVERRIDE_CODES);

let forcedWeather = null;

/** @param {'clear'|'advisory'|'severe'|null} mode */
export function setWeatherOverride(mode) {
  forcedWeather = OVERRIDE_CODES[mode] === undefined ? null : mode;
  return forcedWeather;
}

export function getWeatherOverride() {
  return forcedWeather;
}

export function getWeatherOverrideCode() {
  return forcedWeather === null ? null : OVERRIDE_CODES[forcedWeather];
}

/** True while anything is being simulated, so the UI can say so unmistakably. */
export function isDemoActive() {
  return forcedWeather !== null;
}

export function resetDemo() {
  forcedWeather = null;
}

/**
 * The 15th of a month, as the travel date.
 *
 * Mid-month avoids the edges of every seasonal window, so jumping to a month
 * demonstrates that month's season rather than an ambiguous boundary case - the
 * boundaries themselves are covered by the calendar's own tests.
 *
 * Rolls to next year when the month has already passed, because a travel date in
 * the past is not something the rest of the module should have to handle.
 */
export function dateForMonth(month, today = new Date()) {
  const currentMonth = today.getMonth() + 1;
  const year = month < currentMonth ? today.getFullYear() + 1 : today.getFullYear();
  return `${year}-${String(month).padStart(2, '0')}-15`;
}

export const DiscoveryDemoControls = {
  WEATHER_OVERRIDES,
  setWeatherOverride,
  getWeatherOverride,
  getWeatherOverrideCode,
  isDemoActive,
  resetDemo,
  dateForMonth
};
