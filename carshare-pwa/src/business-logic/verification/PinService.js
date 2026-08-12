// ===== BUSINESS LOGIC LAYER (PinService) =====
// UC6.1 GENERATE PIN / UC6.2 VERIFY PIN.
//
// The generator takes the list of PINs already in play and a random source as
// arguments rather than reaching for the store and Math.random itself. That keeps
// both the collision-retry branch (UC6.1 A1) and the mismatch branch (UC6.2 A1)
// reachable from a unit test with no mocking of globals.

import { PIN_LENGTH, PIN_MAX_GENERATION_ATTEMPTS } from './constants.js';

const PIN_MODULUS = 10 ** PIN_LENGTH;

// Digits only and zero-padded: the Host reads this aloud at the kerb and the Client
// reads it off a phone screen, so anything case-sensitive or alphanumeric invites
// exactly the transcription errors PIN verification exists to rule out.
function formatPin(value) {
  return String(value % PIN_MODULUS).padStart(PIN_LENGTH, '0');
}

/**
 * UC6.1 - generate a PIN that is not already in use by another live trip.
 * Retries on collision (A1); throws only if the space is genuinely exhausted,
 * which surfaces a real problem rather than silently issuing a duplicate.
 */
export function generatePin(existingPins = [], rng = Math.random) {
  const taken = new Set(existingPins);

  for (let attempt = 0; attempt < PIN_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = formatPin(Math.floor(rng() * PIN_MODULUS));
    if (!taken.has(candidate)) {
      return { pin: candidate, attempts: attempt + 1 };
    }
  }

  throw new Error('Unable to generate a unique PIN - too many active trips.');
}

/**
 * UC6.2 C1 - "PIN must match exactly, no partial match".
 * Trimmed because a Host typing on a phone picks up stray whitespace, but never
 * loosened beyond that: no prefix matching, no case folding, no length tolerance.
 */
export function verifyPin(storedPin, enteredPin) {
  if (typeof storedPin !== 'string' || typeof enteredPin !== 'string') return false;
  const entered = enteredPin.trim();
  if (entered.length !== storedPin.length) return false;
  return entered === storedPin;
}

export const PinService = {
  generatePin,
  verifyPin
};
