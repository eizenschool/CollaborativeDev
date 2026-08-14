import { isConfirmedLocation } from '../../../business-logic/GooglePlacesService.js';
import {
  formatMalaysiaDeparture,
  isAtLeastHoursAway,
  REQUEST_CUTOFF_HOURS,
  toDepartureAt
} from '../../../business-logic/rideDateTime.js';

export function getPublishStepError(form, step, { now = new Date() } = {}) {
  if (step === 0 && (!isConfirmedLocation(form.pickupLocation) || !form.destinationLocation?.placeId)) {
    return 'Choose a confirmed Google location for both the pickup point and destination.';
  }
  if (step === 1 && (!form.date || !form.time)) {
    return 'Pick a departure date and time to continue.';
  }
  if (step === 1) {
    const departureAt = toDepartureAt(form.date, form.time);
    if (!isAtLeastHoursAway(departureAt, REQUEST_CUTOFF_HOURS, now)) {
      return `The selected departure is ${formatMalaysiaDeparture(form.date, form.time)}. Choose a time at least 1 hour from now.`;
    }
  }
  if (step === 2 && !form.vehicleId) {
    return 'Choose one of your vehicles to continue.';
  }
  return '';
}

export function canNavigateToPublishStep({ targetStep, currentStep, furthestStep, form, now }) {
  if (targetStep <= currentStep) return true;
  if (targetStep > furthestStep) return false;
  return Array.from({ length: targetStep }, (_, index) => index)
    .every((index) => !getPublishStepError(form, index, { now }));
}
