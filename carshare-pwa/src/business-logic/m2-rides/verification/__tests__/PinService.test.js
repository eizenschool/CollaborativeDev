// Equivalence Partitioning + collision handling - UC6.1 GENERATE PIN / UC6.2 VERIFY PIN.
//
// The random source is injected rather than mocked globally, so the collision-retry
// branch (UC6.1 A1) can be driven deterministically instead of hoping a real random
// generator happens to repeat itself.

import { describe, expect, it } from 'vitest';
import { generatePin, verifyPin } from '../PinService.js';
import { PIN_LENGTH, PIN_MAX_GENERATION_ATTEMPTS } from '../constants.js';

// Feeds generatePin a fixed sequence of "random" values, each scaled to the 0-1
// range the real Math.random would produce for the PIN it should yield.
// The +0.5 aims at the middle of the target integer's bucket rather than its edge,
// so binary rounding can't push Math.floor onto the neighbouring PIN.
function rngYielding(...pins) {
  const queue = pins.map((p) => (Number(p) + 0.5) / 10 ** PIN_LENGTH);
  let i = 0;
  return () => queue[Math.min(i++, queue.length - 1)];
}

describe('generatePin', () => {
  it('produces a zero-padded PIN of the configured length', () => {
    const { pin } = generatePin([], rngYielding('0007'));
    expect(pin).toBe('0007');
    expect(pin).toHaveLength(PIN_LENGTH);
  });

  it('accepts the first candidate when nothing collides', () => {
    const { pin, attempts } = generatePin(['1111', '2222'], rngYielding('4821'));
    expect(pin).toBe('4821');
    expect(attempts).toBe(1);
  });

  // UC6.1 A1 - discard the collision, generate again, and only then store.
  it('retries until it finds a PIN not already in use', () => {
    const { pin, attempts } = generatePin(['1111', '2222'], rngYielding('1111', '2222', '3333'));
    expect(pin).toBe('3333');
    expect(attempts).toBe(3);
  });

  it('throws rather than issuing a duplicate when the space is exhausted', () => {
    const alwaysColliding = rngYielding('1111'); // exhausted queue keeps returning it
    const taken = [generatePin([], alwaysColliding).pin];
    expect(() => generatePin(taken, alwaysColliding)).toThrow(/unique PIN/i);
  });

  it('gives up after the configured number of attempts', () => {
    let calls = 0;
    const counting = () => { calls += 1; return 0.5; };
    expect(() => generatePin(['5000'], counting)).toThrow();
    expect(calls).toBe(PIN_MAX_GENERATION_ATTEMPTS);
  });
});

describe('verifyPin - UC6.2 C1 "must match exactly, no partial match"', () => {
  it('accepts an exact match', () => {
    expect(verifyPin('4821', '4821')).toBe(true);
  });

  it('tolerates surrounding whitespace from a phone keyboard', () => {
    expect(verifyPin('4821', ' 4821 ')).toBe(true);
  });

  it('rejects a correct prefix', () => {
    expect(verifyPin('4821', '482')).toBe(false);
  });

  it('rejects a correct PIN with extra trailing digits', () => {
    expect(verifyPin('4821', '48210')).toBe(false);
  });

  it('rejects transposed digits', () => {
    expect(verifyPin('4821', '4812')).toBe(false);
  });

  it('rejects an empty entry', () => {
    expect(verifyPin('4821', '')).toBe(false);
  });

  it.each([
    ['null entry', '4821', null],
    ['undefined entry', '4821', undefined],
    ['numeric entry', '4821', 4821],
    ['missing stored PIN', null, '4821']
  ])('rejects %s rather than throwing', (_label, stored, entered) => {
    expect(verifyPin(stored, entered)).toBe(false);
  });
});
