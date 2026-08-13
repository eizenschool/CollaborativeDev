// ===== BUSINESS LOGIC LAYER (SeasonalCalendar) =====
// FR-6.24 - weight a destination by its seasonal alignment with the travel date
// and with any registered VM2026 event.
//
// Three outcomes, per the Desirability table:
//   aligned    1.0  an active seasonal window, or a registered VM2026 event
//   undeclared 0.7  no window covers this destination on this date
//   off-season 0.3  a declared off-season window covers it
//
// Undeclared sits well above off-season on purpose. "We hold no seasonal
// information about this place" is not the same claim as "this is a bad time to
// go", and scoring silence as a penalty would quietly bury every destination the
// calendar has not been written for yet.
//
// Windows are declared as data rather than expressed in code, so extending the
// calendar is an edit to a table and not a new branch in a function.
//
// Dates are compared as month/day integers taken straight from the ISO string.
// No Date object is constructed anywhere in this file: `new Date('2026-11-01')`
// parses as UTC midnight and then reports a different local day west of
// Greenwich, which would move every boundary by one day for some users.

import { CATEGORY, SEASON_VALUES } from './constants.js';

export const SEASON = {
  ALIGNED: 'aligned',
  UNDECLARED: 'undeclared',
  OFF: 'off-season'
};

/**
 * How specific a rule is. The most specific match wins, so a rule about one
 * place always beats a rule about its whole state.
 */
const SPECIFICITY = {
  place: 100,
  stateAndCategory: 30,
  state: 20,
  category: 10
};

/**
 * The declared calendar.
 *
 * `from`/`to` are [month, day] and inclusive at both ends. A window whose start
 * is later in the year than its end wraps through December - the north-east
 * monsoon is the reason that case has to exist at all.
 */
export const SEASONAL_WINDOWS = [
  {
    label: 'North-east monsoon',
    kind: SEASON.OFF,
    // Ends on the 29th rather than the 28th so a leap year is covered. The
    // monsoon does not stop early because February is short, and in a common
    // year the 29th simply never arrives.
    from: [11, 1], to: [2, 29],
    states: ['Kelantan', 'Terengganu', 'Pahang'],
    categories: [CATEGORY.NATURE, CATEGORY.EVENT],
    note: 'Heavy rain on the east coast; parks and island access are frequently closed.'
  },
  {
    label: 'Durian season',
    kind: SEASON.ALIGNED,
    from: [6, 1], to: [8, 31],
    categories: [CATEGORY.CULINARY],
    note: 'Peak fruit season nationally; stalls and night markets are at their busiest.'
  },
  {
    label: 'Highland dry months',
    kind: SEASON.ALIGNED,
    from: [6, 1], to: [8, 31],
    places: ['p_cameron'],
    note: 'Clearest months for the tea terraces and forest trails.'
  },
  {
    label: 'Paddy harvest',
    kind: SEASON.ALIGNED,
    from: [4, 1], to: [5, 31],
    places: ['p_sekinchan'],
    note: 'Fields turn gold before harvest.'
  },
  {
    label: 'Second paddy harvest',
    kind: SEASON.ALIGNED,
    from: [9, 1], to: [10, 31],
    places: ['p_sekinchan'],
    note: 'The second of two annual harvest cycles.'
  },
  {
    label: 'Firefly viewing months',
    kind: SEASON.ALIGNED,
    from: [6, 1], to: [8, 31],
    places: ['p_stale_gallery'],
    note: 'Driest months, when the riverside colonies are most visible.'
  },
  {
    label: 'Cave flood risk',
    kind: SEASON.OFF,
    from: [11, 1], to: [1, 31],
    places: ['p_gua_tempurung'],
    note: 'The river passage floods in the wet months and the wet route closes.'
  }
];

/** Month and day as integers, straight from a YYYY-MM-DD string. */
function monthDay(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) return null;
  return { month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Is a date inside an inclusive annual window?
 *
 * Handles the wrapping case - a window from November to February contains both
 * December and January, which a naive "start <= date <= end" comparison gets
 * exactly backwards.
 */
export function isWithinAnnualWindow(isoDate, from, to) {
  const point = monthDay(isoDate);
  if (!point || !Array.isArray(from) || !Array.isArray(to)) return false;

  const asNumber = (month, day) => month * 100 + day;
  const value = asNumber(point.month, point.day);
  const start = asNumber(from[0], from[1]);
  const end = asNumber(to[0], to[1]);

  return start <= end
    ? value >= start && value <= end
    : value >= start || value <= end;
}

/** A registered VM2026 event covering this exact date. ISO strings sort correctly. */
export function isWithinEvent(isoDate, event) {
  if (!event?.start || !event?.end || !isoDate) return false;
  return isoDate >= event.start && isoDate <= event.end;
}

/** How specifically a window addresses this place, or 0 if it does not. */
function specificityFor(window, place) {
  if (window.places?.length) {
    return window.places.includes(place.id) ? SPECIFICITY.place : 0;
  }

  const stateMatches = window.states?.length ? window.states.includes(place.state) : null;
  const categoryMatches = window.categories?.length
    ? window.categories.includes(place.category)
    : null;

  if (stateMatches === false || categoryMatches === false) return 0;
  if (stateMatches && categoryMatches) return SPECIFICITY.stateAndCategory;
  if (stateMatches) return SPECIFICITY.state;
  if (categoryMatches) return SPECIFICITY.category;
  return 0;
}

/**
 * FR-6.24 - the seasonal standing of one destination on one date.
 *
 * Returns the reason alongside the value, so the score breakdown can tell the
 * user *why* a place scored what it did rather than showing an unexplained
 * number.
 *
 * A registered VM2026 event outranks the calendar entirely: an event is a
 * specific commitment on specific dates, and a festival worth travelling for is
 * not made less so by the weather that usually applies to that month.
 */
export function resolveSeason(place = {}, isoDate) {
  if (isWithinEvent(isoDate, place.vm2026Event)) {
    return {
      value: SEASON_VALUES.ALIGNED,
      state: SEASON.ALIGNED,
      label: place.vm2026Event.name || 'Registered VM2026 event',
      note: 'A registered Visit Malaysia 2026 event runs on this date.'
    };
  }

  const matches = SEASONAL_WINDOWS
    .map((window) => ({ window, specificity: specificityFor(window, place) }))
    .filter(({ window, specificity }) =>
      specificity > 0 && isWithinAnnualWindow(isoDate, window.from, window.to));

  if (matches.length === 0) {
    return {
      value: SEASON_VALUES.UNDECLARED,
      state: SEASON.UNDECLARED,
      label: 'No declared season',
      note: 'Nothing in the calendar covers this destination on this date.'
    };
  }

  // Most specific wins. Where two rules are equally specific and disagree, the
  // off-season one is taken: recommending a trip into a closed season is a worse
  // failure than under-selling a good one.
  const best = matches.reduce((winner, candidate) => {
    if (candidate.specificity !== winner.specificity) {
      return candidate.specificity > winner.specificity ? candidate : winner;
    }
    return candidate.window.kind === SEASON.OFF ? candidate : winner;
  });

  const aligned = best.window.kind === SEASON.ALIGNED;
  return {
    value: aligned ? SEASON_VALUES.ALIGNED : SEASON_VALUES.OFF_SEASON,
    state: aligned ? SEASON.ALIGNED : SEASON.OFF,
    label: best.window.label,
    note: best.window.note
  };
}

export const SeasonalCalendar = {
  SEASON,
  SEASONAL_WINDOWS,
  isWithinAnnualWindow,
  isWithinEvent,
  resolveSeason
};
