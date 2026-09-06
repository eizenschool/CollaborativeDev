// ===== BUSINESS LOGIC (local calendar date) =====
//
// `new Date().toISOString().slice(0, 10)` reads the UTC calendar, not the
// traveller's. Malaysia is UTC+8, so between 00:00 and 08:00 local it reports
// yesterday - every discovery screen opened in that window defaulted to a past
// travel date, scored it, and showed the departures of a day already gone.
//
// This is the same trap SeasonalCalendar.js documents for window boundaries.
// It reads month and day off the ISO string precisely to avoid Date's timezone
// behaviour; here the Date is unavoidable, so the local getters are used and no
// UTC conversion happens at any point.

/** Today in the device's own timezone, as YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
