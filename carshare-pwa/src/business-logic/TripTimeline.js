// ===== BUSINESS LOGIC LAYER (TripTimeline) =====
// Module 5 - the story of one trip, assembled from timestamps other modules
// already record (FR-5.3).
//
// Nothing here is invented or stored: Module 2 writes every one of these
// instants (database/sql/013 for the request lifecycle, 028 for arrival and
// completion), and this only orders them and says which have happened.
//
// A step is one of:
//   done     - it happened, and we know when
//   due      - it is the next thing expected, and its time has arrived
//   upcoming - scheduled or awaited, still ahead
//   skipped  - the trip ended before reaching it

export const STEP_STATE = {
  DONE: 'done',
  DUE: 'due',
  UPCOMING: 'upcoming',
  SKIPPED: 'skipped'
};

const TERMINAL_STATES = new Set(['Cancelled', 'Expired']);

function earliest(values) {
  const times = values.filter(Boolean).sort();
  return times[0] || null;
}

function step(id, label, at, state, detail = null) {
  return { id, label, at, state, detail };
}

/**
 * @param ride      a mapped ride (camelCase), as RideService returns it
 * @param requests  ride requests visible to the viewer (may be just their own)
 * @param lifecycle RideService.getLifecycleContext() result, or null
 */
export function buildTripTimeline({ ride, requests = [], lifecycle = null, now = new Date() }) {
  if (!ride) return [];

  const instant = now instanceof Date ? now : new Date(now);
  const departed = ride.departureAt ? new Date(ride.departureAt) <= instant : false;
  const accepted = requests.filter((request) => request.status === 'Accepted');

  const completedAt = lifecycle?.completedAt || ride.completedAt || null;
  const driverArrivedAt = lifecycle?.driverArrivedAt || ride.driverArrivedAt || null;
  const terminal = TERMINAL_STATES.has(ride.status);

  const steps = [];

  steps.push(step('created', 'Trip created', ride.createdAt || null, STEP_STATE.DONE));

  if (ride.publishedAt) {
    steps.push(step('published', 'Published to the marketplace', ride.publishedAt, STEP_STATE.DONE));
  } else if (ride.status === 'Draft') {
    steps.push(step('published', 'Not published yet', null, STEP_STATE.UPCOMING));
  }

  const firstRequestAt = earliest(requests.map((request) => request.createdAt));
  if (firstRequestAt) {
    const count = requests.length;
    steps.push(step(
      'requested',
      count === 1 ? 'A passenger asked to join' : `${count} passengers asked to join`,
      firstRequestAt,
      STEP_STATE.DONE
    ));
  } else if (ride.publishedAt && !terminal) {
    steps.push(step('requested', 'Waiting for passengers', null, STEP_STATE.UPCOMING));
  }

  const firstAcceptedAt = earliest(accepted.map((request) => request.processedAt || request.updatedAt));
  if (accepted.length > 0) {
    const seats = accepted.reduce((sum, request) => sum + (request.seatsRequested || 1), 0);
    steps.push(step(
      'accepted',
      seats === 1 ? '1 seat confirmed' : `${seats} seats confirmed`,
      firstAcceptedAt,
      STEP_STATE.DONE
    ));
  }

  if (ride.recruitmentClosedAt) {
    steps.push(step('matched', 'Recruitment closed', ride.recruitmentClosedAt, STEP_STATE.DONE));
  }

  // The scheduled instant is a step in its own right - it is the only one the
  // user knew about in advance.
  steps.push(step(
    'departure',
    departed ? 'Departed' : 'Scheduled departure',
    ride.departureAt || null,
    departed ? STEP_STATE.DONE : STEP_STATE.UPCOMING
  ));

  if (terminal) {
    if (ride.status === 'Cancelled') {
      steps.push(step('cancelled', 'Trip cancelled', ride.cancelledAt || ride.updatedAt || null, STEP_STATE.DONE, ride.cancelReason || null));
    } else {
      steps.push(step('expired', 'Expired - nobody joined', ride.expiredAt || null, STEP_STATE.DONE));
    }
    return inChronologicalOrder(steps);
  }

  if (driverArrivedAt) {
    steps.push(step('arrived', 'Driver confirmed arrival', driverArrivedAt, STEP_STATE.DONE));
  } else if (departed) {
    steps.push(step('arrived', 'Waiting on arrival confirmation', null, STEP_STATE.DUE));
  } else {
    steps.push(step('arrived', 'Arrival confirmation', null, STEP_STATE.UPCOMING));
  }

  if (completedAt) {
    steps.push(step('completed', 'Trip completed', completedAt, STEP_STATE.DONE));
  } else {
    steps.push(step(
      'completed',
      'Trip completion',
      null,
      driverArrivedAt ? STEP_STATE.DUE : STEP_STATE.UPCOMING,
      // Explains the gap Module 5 kept hitting: a trip only completes once both
      // sides confirm, and that pipeline is Module 2's.
      driverArrivedAt ? 'Waiting for passengers to confirm they arrived.' : null
    ));
  }

  return inChronologicalOrder(steps);
}

// The steps above are built in lifecycle order, but Module 2's records do not
// always land in that order - a ride can be closed to new requests after its
// departure instant, for example. A timeline that prints a later clock time
// above an earlier one reads as broken.
//
// So: everything that has an instant is ordered by that instant, and anything
// still awaited follows in lifecycle order. Sorting the awaited steps in among
// the timed ones would put "not yet" above something that already happened.
function inChronologicalOrder(steps) {
  const timed = [];
  const awaited = [];
  for (const item of steps) {
    const at = item.at ? new Date(item.at).getTime() : NaN;
    (Number.isNaN(at) ? awaited : timed).push({ item, at });
  }
  timed.sort((a, b) => a.at - b.at);
  return [...timed, ...awaited].map((entry) => entry.item);
}

export function timelineProgress(steps) {
  const done = steps.filter((item) => item.state === STEP_STATE.DONE).length;
  return { done, total: steps.length };
}
