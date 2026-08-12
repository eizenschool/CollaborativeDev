export const APP_TIME_ZONE = 'Asia/Kuala_Lumpur';
export const REQUEST_CUTOFF_HOURS = 5;

export function toDepartureAt(date, time) {
  if (!date || !time) return null;
  const instant = new Date(`${date}T${time}:00+08:00`);
  if (Number.isNaN(instant.getTime())) throw new Error('Enter a valid departure date and time.');
  return instant.toISOString();
}

export function departureParts(departureAt) {
  if (!departureAt) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(departureAt));
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`
  };
}

export function klDayRange(date) {
  if (!date) return null;
  const start = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) throw new Error('Enter a valid search date.');
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString()
  };
}

export function isAtLeastHoursAway(departureAt, hours = REQUEST_CUTOFF_HOURS, now = new Date()) {
  return new Date(departureAt).getTime() - now.getTime() >= hours * 60 * 60 * 1000;
}

export function isBeforeDeparture(departureAt, now = new Date()) {
  return now.getTime() < new Date(departureAt).getTime();
}
