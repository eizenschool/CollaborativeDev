// State resolution. Ingestion used to stamp every row with the sweep region's
// configured state, so a 50 km circle centred on George Town filed Kedah places
// as Penang. ChainDetection scopes by state, so this changed which places were
// compared against each other, not just what the card said.
import { describe, it, expect } from 'vitest';
import { stateFromAddress } from '../address.ts';

const component = (longText, types) => ({ longText, shortText: longText, types });

describe('stateFromAddress', () => {
  it('reads the administrative_area_level_1 component', () => {
    const components = [
      component('Jalan Kulim', ['route']),
      component('Kulim', ['locality', 'political']),
      component('Kedah', ['administrative_area_level_1', 'political']),
      component('Malaysia', ['country', 'political'])
    ];
    // The real case: found by the Penang sweep, actually in Kedah.
    expect(stateFromAddress(components, 'Penang')).toBe('Kedah');
  });

  it('ignores components that merely contain the word', () => {
    const components = [
      component('Penang Road', ['route']),
      component('George Town', ['locality']),
      component('Penang', ['administrative_area_level_1'])
    ];
    expect(stateFromAddress(components, 'Kedah')).toBe('Penang');
  });

  it('normalises the spellings that would fragment an existing state group', () => {
    // Twenty rows already say "Kuala Lumpur". If Google's own spelling were
    // written through unchanged the catalogue would hold two states with the
    // same twenty places split between them, and ChainDetection would compare
    // each half only against itself.
    const kl = [component('Federal Territory of Kuala Lumpur', ['administrative_area_level_1'])];
    expect(stateFromAddress(kl)).toBe('Kuala Lumpur');

    expect(stateFromAddress([component('Pulau Pinang', ['administrative_area_level_1'])]))
      .toBe('Penang');
    expect(stateFromAddress([component('Malacca', ['administrative_area_level_1'])]))
      .toBe('Melaka');
    expect(stateFromAddress([component('Selangor Darul Ehsan', ['administrative_area_level_1'])]))
      .toBe('Selangor');
  });

  it('is case-insensitive about the alias, but not about the result', () => {
    expect(stateFromAddress([component('PULAU PINANG', ['administrative_area_level_1'])]))
      .toBe('Penang');
  });

  it('passes an unrecognised state through as Google spelled it', () => {
    // Better a new state under its own name than a wrong one under a familiar
    // name, so there is no fuzzy matching here.
    expect(stateFromAddress([component('Sarawak', ['administrative_area_level_1'])]))
      .toBe('Sarawak');
  });

  it('falls back to the region only when Google supplies no state at all', () => {
    expect(stateFromAddress([component('Malaysia', ['country'])], 'Penang')).toBe('Penang');
    expect(stateFromAddress([], 'Penang')).toBe('Penang');
    expect(stateFromAddress(undefined, 'Penang')).toBe('Penang');
    expect(stateFromAddress(null, 'Penang')).toBe('Penang');
  });

  it('falls back when the state component is present but empty', () => {
    const blank = [component('   ', ['administrative_area_level_1'])];
    expect(stateFromAddress(blank, 'Melaka')).toBe('Melaka');
  });

  it('tolerates malformed components without throwing', () => {
    const junk = [null, {}, { types: null }, { types: ['administrative_area_level_1'] }];
    expect(stateFromAddress(junk, 'Selangor')).toBe('Selangor');
  });

  it('returns an empty string rather than undefined when there is no fallback', () => {
    // places.state is `not null default ''`, so the caller must never write
    // undefined into it.
    expect(stateFromAddress([])).toBe('');
  });
});
