// ===== BUSINESS LOGIC LAYER (malaysianIdentity) =====
// One MyKad validator, shared by the two places that need it: the sign-up
// identity gate (AuthService) and the driver's license field (VehicleService).
// A Malaysian driving license carries the holder's MyKad number as its licence
// number - JPJ does not issue citizens a separate serial - so both fields have
// the same shape and must not drift apart.
//
// Nothing here is identity verification. MyKad has no check digit, so an
// offline gate can prove structure only: that the number could exist, never
// that it belongs to the person typing it.

// Birthplace codes JPN has never assigned. Everything else in 01-99 is a
// state, a federal territory, a foreign country of birth, or a documented
// "unknown" marker, so only this set can be rejected without turning away real
// MyKad holders.
const UNASSIGNED_BIRTHPLACE_CODES = new Set([
  '00', '17', '18', '19', '20', '69', '70', '73', '80', '81', '94', '95', '96', '97'
]);

const MYKAD_SHAPE = /^\d{6}-?\d{2}-?\d{4}$/;

function isRealBirthDate(yymmdd) {
  const year = Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  if (month < 1 || month > 12 || day < 1) return false;
  // The century is not encoded, so the date is real when either reading is -
  // this only changes the answer for 29 February.
  return [1900 + year, 2000 + year].some(
    (fullYear) => day <= new Date(Date.UTC(fullYear, month, 0)).getUTCDate()
  );
}

// 6-digit birth date (YYMMDD) + 2-digit birthplace code + 4-digit registration
// serial, with or without the conventional dashes. The serial has no public
// rule, so it stays unchecked.
export function validateMalaysianIC(value) {
  const trimmed = (value || '').trim();
  if (!MYKAD_SHAPE.test(trimmed)) return false;
  const digits = trimmed.replace(/-/g, '');
  if (!isRealBirthDate(digits.slice(0, 6))) return false;
  return !UNASSIGNED_BIRTHPLACE_CODES.has(digits.slice(6, 8));
}

// Stored without dashes so two spellings of the same number cannot be saved as
// two different licences.
export function normalizeMalaysianIC(value) {
  return (value || '').trim().replace(/-/g, '');
}

export function formatMalaysianIC(value) {
  const digits = normalizeMalaysianIC(value);
  if (digits.length !== 12) return value || '';
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

// A licence that has already lapsed is not an eligibility gate anybody can
// pass. Compared date-only: a licence is valid through the whole of its expiry
// day, wherever the holder is.
export function isDriverLicenseCurrent(expiry, now = new Date()) {
  if (!expiry) return false;
  const expiryDate = new Date(`${String(expiry).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(expiryDate.getTime())) return false;
  const today = new Date(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
  return expiryDate >= today;
}

// JPJ's minimum age for a Class D (car) licence.
export const MIN_DRIVING_AGE = 17;

// The century is not encoded, so it is inferred the only sane way for a
// currently-living applicant: whichever reading does not put the birth date in
// the future. This resolves the same two-digit year differently depending on
// when it is asked - correct for "how old are they today", unlike
// isRealBirthDate above, which deliberately leaves the century open because it
// only needs "could this date have ever existed".
function resolveBirthYear(twoDigitYear, referenceYear) {
  const century = twoDigitYear <= referenceYear % 100 ? 2000 : 1900;
  return century + twoDigitYear;
}

// Returns the age a MyKad's birth date implies as of `now`, or null when the
// number is not a well-formed MyKad. Not identity verification - an offline
// gate can only prove the number's own structure, never that it belongs to
// the person who typed it.
export function ageFromMalaysianIC(value, now = new Date()) {
  const digits = normalizeMalaysianIC(value);
  if (digits.length !== 12) return null;
  const referenceYear = now.getUTCFullYear();
  const year = resolveBirthYear(Number(digits.slice(0, 2)), referenceYear);
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(birthDate.getTime())) return null;

  let age = referenceYear - year;
  const hadBirthdayThisYear = now.getUTCMonth() > month - 1
    || (now.getUTCMonth() === month - 1 && now.getUTCDate() >= day);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// Publishing puts the member behind the wheel, so it is the one gate that
// needs this - requesting to join a ride or messaging another member does
// not. Kept separate from validateIdentitySubmission for exactly that reason:
// submission is shared by every member, this check is not.
export function isOldEnoughToDrive(icNumber, now = new Date()) {
  const age = ageFromMalaysianIC(icNumber, now);
  return age !== null && age >= MIN_DRIVING_AGE;
}
