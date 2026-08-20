import { REQUEST_CUTOFF_HOURS } from './rideDateTime.js';

export const RIDE_ACTION = Object.freeze({
  CONTINUE_DRAFT: 'continue_draft',
  DELETE_DRAFT: 'delete_draft',
  REVIEW_REQUESTS: 'review_requests',
  VIEW_RIDE: 'view_ride',
  CHECK_IN: 'check_in',
  RESOLVE_BOARDING: 'resolve_boarding',
  START_RIDE: 'start_ride',
  OPEN_NAVIGATION: 'open_navigation',
  CONFIRM_DRIVER_ARRIVAL: 'confirm_driver_arrival',
  CONFIRM_PASSENGER_ARRIVAL: 'confirm_passenger_arrival',
  WAIT_FOR_DRIVER: 'wait_for_driver',
  WAIT_FOR_PASSENGERS: 'wait_for_passengers',
  TRACK_REQUEST: 'track_request',
  REVIEW_RIDE: 'review_ride',
  NONE: 'none'
});

const TERMINAL_RIDE_STATUSES = new Set(['Cancelled', 'Expired']);
const TERMINAL_REQUEST_STATUSES = new Set(['Rejected', 'Cancelled', 'Expired']);
const HOUR_MS = 60 * 60 * 1000;

function departureTime(ride) {
  const value = new Date(ride?.departureAt || `${ride?.date || ''}T${ride?.time || '00:00'}`).getTime();
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function action(id, label, path = null) {
  return { id, label, path };
}

function result({ role, phase, urgency = 'normal', priority, title, description, nextAction, countdownAt = null, blockers = [], meta = {} }) {
  return { role, phase, urgency, priority, title, description, nextAction, countdownAt, blockers, meta };
}

export function getRideJourneyState({ ride, role, request = null, requests = [], lifecycleContext = null, reviewEligibility = null, now = new Date() }) {
  const rideId = ride?.id;
  const ridePath = rideId ? `/ride/${rideId}` : '/ride';
  const tripPath = `${ridePath}?view=trip`;
  const departureAt = departureTime(ride);
  const nowTime = new Date(now).getTime();
  const millisecondsToDeparture = departureAt - nowTime;
  const withinCheckInWindow = millisecondsToDeparture <= REQUEST_CUTOFF_HOURS * HOUR_MS;
  const departureReached = millisecondsToDeparture <= 0;
  const status = ride?.status;
  const reviewDataLoaded = Array.isArray(reviewEligibility);
  const hasReviewTargets = reviewDataLoaded && reviewEligibility.length > 0;
  const reviewsComplete = hasReviewTargets && reviewEligibility.every((item) => item.existingRating != null);

  function completedState(completedRole) {
    if (reviewsComplete) {
      return result({
        role: completedRole, phase: 'completed', priority: 60,
        title: 'Review submitted', description: 'Your feedback for this ride is already saved.',
        nextAction: action(RIDE_ACTION.REVIEW_RIDE, 'View your review', `/ride/${rideId}/review`)
      });
    }
    if (reviewDataLoaded && !hasReviewTargets) {
      return result({
        role: completedRole, phase: 'completed', priority: 60,
        title: 'Ride completed', description: 'There is no remaining review action for this ride.',
        nextAction: action(RIDE_ACTION.VIEW_RIDE, 'View details', ridePath)
      });
    }
    return result({
      role: completedRole, phase: 'completed', priority: 60,
      title: 'Ride completed',
      description: completedRole === 'driver' ? 'Share feedback about your accepted passengers.' : 'Rate your Driver and share your experience.',
      nextAction: action(RIDE_ACTION.REVIEW_RIDE, completedRole === 'driver' ? 'Rate passengers' : 'Rate Driver', `/ride/${rideId}/review`)
    });
  }

  if (role === 'driver') {
    if (status === 'Draft') {
      return result({
        role, phase: 'draft', priority: 50,
        title: 'Finish your draft',
        description: 'Continue the five-step flow when you are ready to publish.',
        nextAction: action(RIDE_ACTION.CONTINUE_DRAFT, 'Continue draft', `/ride/${rideId}/publish`),
        countdownAt: ride?.departureAt || null
      });
    }
    if (status === 'Completed') {
      return completedState(role);
    }
    if (TERMINAL_RIDE_STATUSES.has(status)) {
      return result({
        role, phase: 'terminal', priority: 80,
        title: `Ride ${String(status).toLowerCase()}`, description: 'No further trip action is required.',
        nextAction: action(RIDE_ACTION.VIEW_RIDE, 'View details', ridePath)
      });
    }

    const accepted = requests.filter((item) => item.status === 'Accepted');
    const pendingRequests = requests.filter((item) => item.status === 'Pending');
    const checkedIn = accepted.filter((item) => item.boardingStatus === 'Checked In');
    const unresolved = accepted.filter((item) => item.boardingStatus === 'Pending');
    const readiness = { accepted: accepted.length, checkedIn: checkedIn.length, unresolved: unresolved.length, pendingRequests: pendingRequests.length };

    if (status === 'In Transit') {
      if (lifecycleContext?.driverArrivedAt) {
        return result({
          role, phase: 'arrival', urgency: 'now', priority: 1,
          title: 'Waiting for arrival confirmations',
          description: 'Checked-in passengers can now confirm that they arrived.',
          nextAction: action(RIDE_ACTION.WAIT_FOR_PASSENGERS, 'View confirmations', tripPath),
          meta: readiness
        });
      }
      return result({
        role, phase: 'in_transit', urgency: 'now', priority: 1,
        title: 'Ride in progress', description: 'Keep navigation open. Confirm arrival only after reaching the destination.',
        nextAction: action(RIDE_ACTION.CONFIRM_DRIVER_ARRIVAL, 'Open trip mode', tripPath),
        meta: readiness
      });
    }

    if (departureReached && ['Published', 'Matched'].includes(status)) {
      if (unresolved.length) {
        return result({
          role, phase: 'departure', urgency: 'now', priority: 2,
          title: 'Resolve boarding before departure',
          description: `${unresolved.length} accepted passenger${unresolved.length === 1 ? '' : 's'} still ${unresolved.length === 1 ? 'needs' : 'need'} Check-in or No-show resolution.`,
          nextAction: action(RIDE_ACTION.RESOLVE_BOARDING, 'Resolve boarding', tripPath),
          countdownAt: ride?.departureAt || null, blockers: ['Unresolved accepted passengers'], meta: readiness
        });
      }
      if (checkedIn.length) {
        return result({
          role, phase: 'departure', urgency: 'now', priority: 2,
          title: 'Ready to start', description: `${checkedIn.length} passenger${checkedIn.length === 1 ? '' : 's'} checked in.`,
          nextAction: action(RIDE_ACTION.START_RIDE, 'Start ride', tripPath), countdownAt: ride?.departureAt || null, meta: readiness
        });
      }
      return result({
        role, phase: 'departure', urgency: 'now', priority: 2,
        title: 'No passenger is ready',
        description: 'Wait for an accepted passenger to Check in, contact the group, or cancel the shared ride.',
        nextAction: action(RIDE_ACTION.RESOLVE_BOARDING, 'Open trip mode', tripPath),
        countdownAt: ride?.departureAt || null, blockers: ['At least one checked-in passenger is required'], meta: readiness
      });
    }

    if (withinCheckInWindow && ['Published', 'Matched'].includes(status)) {
      return result({
        role, phase: 'check_in', urgency: 'soon', priority: 3,
        title: 'Prepare for departure',
        description: `${checkedIn.length} of ${accepted.length} accepted passenger${accepted.length === 1 ? '' : 's'} checked in.`,
        nextAction: action(RIDE_ACTION.RESOLVE_BOARDING, 'View readiness', tripPath),
        countdownAt: ride?.departureAt || null, meta: readiness
      });
    }

    if (pendingRequests.length) {
      return result({
        role, phase: 'upcoming', urgency: 'soon', priority: 4,
        title: `${pendingRequests.length} request${pendingRequests.length === 1 ? '' : 's'} need a decision`,
        description: 'Review passenger requests before the departure deadline.',
        nextAction: action(RIDE_ACTION.REVIEW_REQUESTS, 'Review requests', `/ride/${rideId}/requests`),
        countdownAt: ride?.departureAt || null, meta: readiness
      });
    }

    return result({
      role, phase: 'upcoming', priority: 10,
      title: status === 'Matched' ? 'Upcoming matched ride' : 'Upcoming ride',
      description: status === 'Matched' ? 'Passengers are confirmed. Check the trip details before departure.' : 'Your ride is published and ready for requests.',
      nextAction: action(RIDE_ACTION.VIEW_RIDE, 'View ride', ridePath), countdownAt: ride?.departureAt || null, meta: readiness
    });
  }

  if (status === 'Completed') {
    return completedState('passenger');
  }
  if (TERMINAL_RIDE_STATUSES.has(status) || TERMINAL_REQUEST_STATUSES.has(request?.status) || request?.boardingStatus === 'No-show') {
    const label = request?.boardingStatus === 'No-show' ? 'Marked No-show' : request?.status || status || 'Closed';
    return result({
      role: 'passenger', phase: 'terminal', priority: 80,
      title: label, description: request?.decisionReason || 'This request no longer has an available action.',
      nextAction: action(RIDE_ACTION.VIEW_RIDE, 'View details', ridePath)
    });
  }
  if (request?.status === 'Pending') {
    return result({
      role: 'passenger', phase: 'upcoming', urgency: 'soon', priority: 4,
      title: 'Request awaiting Host', description: 'You can track or cancel this request before departure.',
      nextAction: action(RIDE_ACTION.TRACK_REQUEST, 'Track request', ridePath), countdownAt: ride?.departureAt || null
    });
  }
  if (request?.status !== 'Accepted') {
    return result({
      role: 'passenger', phase: 'terminal', priority: 80,
      title: 'No active request', description: 'There is no active passenger action for this ride.',
      nextAction: action(RIDE_ACTION.VIEW_RIDE, 'View details', ridePath)
    });
  }

  if (status === 'In Transit') {
    if (lifecycleContext?.driverArrivedAt && !request.arrivalConfirmedAt && request.boardingStatus === 'Checked In') {
      return result({
        role: 'passenger', phase: 'arrival', urgency: 'now', priority: 1,
        title: 'Confirm you arrived', description: 'The Driver has confirmed arrival at the destination.',
        nextAction: action(RIDE_ACTION.CONFIRM_PASSENGER_ARRIVAL, 'Confirm I arrived', tripPath)
      });
    }
    if (request.arrivalConfirmedAt) {
      return result({
        role: 'passenger', phase: 'arrival', urgency: 'now', priority: 1,
        title: 'Arrival confirmed', description: 'Waiting for the remaining confirmations.',
        nextAction: action(RIDE_ACTION.WAIT_FOR_PASSENGERS, 'View trip', tripPath)
      });
    }
    return result({
      role: 'passenger', phase: 'in_transit', urgency: 'now', priority: 1,
      title: 'Ride in progress', description: 'Follow the route and use the trip group to stay in contact.',
      nextAction: action(RIDE_ACTION.OPEN_NAVIGATION, 'Open trip mode', tripPath)
    });
  }

  if (request.boardingStatus === 'Checked In') {
    return result({
      role: 'passenger', phase: 'departure', urgency: withinCheckInWindow ? 'soon' : 'normal', priority: withinCheckInWindow ? 2 : 10,
      title: 'You are checked in', description: departureReached ? 'Wait for the Driver to start the ride.' : 'Be ready at the pickup point before departure.',
      nextAction: action(RIDE_ACTION.WAIT_FOR_DRIVER, 'View trip', tripPath), countdownAt: ride?.departureAt || null
    });
  }

  if (withinCheckInWindow && ['Published', 'Matched'].includes(status)) {
    return result({
      role: 'passenger', phase: 'check_in', urgency: departureReached ? 'now' : 'soon', priority: 2,
      title: 'Check in near pickup', description: 'Use GPS within 200 m of the pickup point. Accuracy must be 100 m or better.',
      nextAction: action(RIDE_ACTION.CHECK_IN, 'Check in', tripPath), countdownAt: ride?.departureAt || null
    });
  }

  return result({
    role: 'passenger', phase: 'upcoming', priority: 10,
    title: 'Upcoming accepted ride', description: 'Your seat is confirmed. Check-in opens one hour before departure.',
    nextAction: action(RIDE_ACTION.VIEW_RIDE, 'View ride', ridePath), countdownAt: ride?.departureAt || null
  });
}

export function compareJourneyStates(left, right) {
  if (left.state.priority !== right.state.priority) return left.state.priority - right.state.priority;
  return departureTime(left.ride) - departureTime(right.ride);
}

export function journeyGroup(state) {
  if (state.priority <= 4) return 'attention';
  if (state.phase === 'draft') return 'drafts';
  if (['completed', 'terminal'].includes(state.phase)) return 'history';
  return 'upcoming';
}

export function isTripModeEligible(state) {
  return ['check_in', 'departure', 'in_transit', 'arrival'].includes(state?.phase);
}

export function formatJourneyCountdown(target, now = new Date()) {
  if (!target) return '';
  const difference = new Date(target).getTime() - new Date(now).getTime();
  if (!Number.isFinite(difference)) return '';
  const absoluteMinutes = Math.round(Math.abs(difference) / 60000);
  if (difference <= 0) return absoluteMinutes < 1 ? 'Departure time' : `${absoluteMinutes} min overdue`;
  if (absoluteMinutes < 60) return `Leaves in ${Math.max(1, absoluteMinutes)} min`;
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  if (hours < 24) return `Leaves in ${hours}h${minutes ? ` ${minutes}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `Leaves in ${days} day${days === 1 ? '' : 's'}`;
}
