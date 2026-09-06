// ===== BUSINESS LOGIC LAYER (TripAchievements) =====
// Module 5 - milestones earned from completed trips (FR-5.6 / FR-5.7).
//
// Every milestone is derived from the same history TripHistoryEngine already
// returns - nothing new is stored, and nothing here can disagree with the
// numbers on the Impact dashboard. Locked milestones carry their own progress
// so the grid shows how far away the next one is rather than just hiding it.

// A mature tree absorbs roughly this much CO2 a year - the figure the Impact
// dashboard and the shareable card both quote, kept in one place.
export const KG_PER_TREE_YEAR = 21;

function passengersCarriedOn(trip) {
  return Math.max(0, (trip.seatsTotal || 0) - (trip.seatsAvailable ?? 0));
}

// Longest run of consecutive calendar months that each contain a completed
// trip, counted from the card's Asia/Kuala_Lumpur date so it matches the UI.
export function longestMonthlyStreak(trips) {
  const months = [...new Set(trips.map((trip) => trip.date.slice(0, 7)))].sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const month of months) {
    const [year, mon] = month.split('-').map(Number);
    const index = year * 12 + (mon - 1);
    run = previous !== null && index === previous + 1 ? run + 1 : 1;
    previous = index;
    if (run > best) best = run;
  }
  return best;
}

export function summariseForAchievements(completedTrips) {
  const hosted = completedTrips.filter((trip) => trip.role === 'Host');
  return {
    trips: completedTrips.length,
    hostedTrips: hosted.length,
    carbonKg: Math.round(completedTrips.reduce((sum, t) => sum + (t.carbonSavedKg || 0), 0) * 10) / 10,
    distanceKm: Math.round(completedTrips.reduce((sum, t) => sum + (t.distanceKm || 0), 0)),
    passengersCarried: hosted.reduce((sum, t) => sum + passengersCarriedOn(t), 0),
    fullestCar: hosted.reduce((most, t) => Math.max(most, passengersCarriedOn(t)), 0),
    longestTripKm: completedTrips.reduce((most, t) => Math.max(most, t.distanceKm || 0), 0),
    monthlyStreak: longestMonthlyStreak(completedTrips)
  };
}

// Symbols never take a plural - "50 kgs" is wrong where "3 seats" is right.
const SYMBOL_UNITS = new Set(['kg', 'km']);

function unitLabel(unit, count) {
  if (SYMBOL_UNITS.has(unit)) return unit;
  return count === 1 ? unit : unit + 's';
}

// `target` is what the milestone needs; `value` reads the summary above.
// Ordered so the grid reads as a progression rather than a random wall.
const MILESTONES = [
  { id: 'first-trip', name: 'First Ride', icon: '🚗', tone: 'primary', unit: 'trip', value: (s) => s.trips, target: 1,
    description: 'Complete your first shared trip.' },
  { id: 'carbon-10', name: 'Carbon Saver', icon: '🌱', tone: 'teal', unit: 'kg', value: (s) => s.carbonKg, target: 10,
    description: 'Save 10 kg of CO₂.' },
  { id: 'carbon-50', name: 'Climate Ally', icon: '🌳', tone: 'teal', unit: 'kg', value: (s) => s.carbonKg, target: 50,
    description: 'Save 50 kg of CO₂ - about a tree-year and a half.' },
  { id: 'carbon-200', name: 'Carbon Champion', icon: '🏆', tone: 'gold', unit: 'kg', value: (s) => s.carbonKg, target: 200,
    description: 'Save 200 kg of CO₂.' },
  { id: 'distance-500', name: 'Road Tripper', icon: '🛣️', tone: 'primary', unit: 'km', value: (s) => s.distanceKm, target: 500,
    description: 'Share 500 km of travel.' },
  { id: 'long-haul', name: 'Long Hauler', icon: '🗺️', tone: 'primary', unit: 'km', value: (s) => s.longestTripKm, target: 100,
    description: 'Complete a single trip of 100 km or more.' },
  { id: 'full-car', name: 'Full Car', icon: '👥', tone: 'teal', unit: 'seat', value: (s) => s.fullestCar, target: 3,
    description: 'Carry three passengers on one trip.' },
  { id: 'passengers-10', name: 'Community Host', icon: '🤝', tone: 'gold', unit: 'passenger', value: (s) => s.passengersCarried, target: 10,
    description: 'Carry ten passengers in total.' },
  { id: 'streak-3', name: 'Regular', icon: '📅', tone: 'primary', unit: 'month', value: (s) => s.monthlyStreak, target: 3,
    description: 'Complete a trip three months running.' }
];

export function evaluateAchievements(completedTrips = []) {
  const summary = summariseForAchievements(completedTrips);

  const milestones = MILESTONES.map((milestone) => {
    const current = milestone.value(summary);
    const earned = current >= milestone.target;
    return {
      id: milestone.id,
      name: milestone.name,
      icon: milestone.icon,
      tone: milestone.tone,
      description: milestone.description,
      earned,
      current: Math.round(current * 10) / 10,
      target: milestone.target,
      unit: milestone.unit,
      targetLabel: unitLabel(milestone.unit, milestone.target),
      // 0-1, for the progress bar on a locked milestone.
      ratio: milestone.target > 0 ? Math.min(1, current / milestone.target) : 0
    };
  });

  const earnedCount = milestones.filter((m) => m.earned).length;
  // The closest locked milestone, so the dashboard can name a next goal.
  const nextUp = milestones
    .filter((m) => !m.earned)
    .sort((a, b) => b.ratio - a.ratio)[0] || null;

  return {
    summary,
    milestones,
    earnedCount,
    total: milestones.length,
    nextUp,
    treesEquivalent: Math.round(summary.carbonKg / KG_PER_TREE_YEAR)
  };
}
