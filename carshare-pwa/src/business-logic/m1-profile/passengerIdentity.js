// Basic document entry checks, not automated identity verification.
export function normalizeIdentityNumber(type, value = '') {
  const text = String(value).trim();
  return type === 'passport' ? text.toUpperCase() : text.replace(/[\s-]/g, '');
}

export function validatePassengerIdentityNumber(type, value) {
  const number = normalizeIdentityNumber(type, value);
  if (type === 'mykad') return /^[0-9]{12}$/.test(number);
  if (type === 'passport') return /^[A-Z0-9]{5,20}$/.test(number);
  return false;
}
