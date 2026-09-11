// Boundary Value Analysis - FR-6.26 chain identification by name recurrence
// across three or more distinct place records within the same state.
//
// The threshold and the state scoping are both load bearing: two outlets is a
// coincidence, three is a pattern, and the same count spread across states says
// nothing at all.

import { describe, expect, it } from 'vitest';
import {
  buildNameRecurrenceIndex,
  isChain,
  localEconomySignal,
  localEconomySignalsFor,
  normaliseName
} from '../ChainDetection.js';
import { CHAIN_NAME_RECURRENCE, LOCAL_VALUES } from '../constants.js';

const outlet = (id, name, state) => ({ placeId: id, name, state });

describe('normaliseName', () => {
  it('collapses case and surrounding whitespace', () => {
    expect(normaliseName('  Restoran Ali  ')).toBe('restoran ali');
    expect(normaliseName('RESTORAN ALI')).toBe('restoran ali');
  });

  it('collapses runs of internal whitespace', () => {
    expect(normaliseName('Restoran   Ali')).toBe('restoran ali');
  });

  it('returns an empty string for a missing or non-string name', () => {
    expect(normaliseName(undefined)).toBe('');
    expect(normaliseName(null)).toBe('');
    expect(normaliseName(42)).toBe('');
  });
});

describe('isChain - BVA on the three-record recurrence threshold', () => {
  const chainOf = (count, state = 'Selangor') =>
    Array.from({ length: count }, (_, i) => outlet(`p_${i}`, 'Restoran Ali', state));

  it('is not a chain one record short of the threshold', () => {
    const places = chainOf(CHAIN_NAME_RECURRENCE - 1);
    expect(isChain(places[0], buildNameRecurrenceIndex(places))).toBe(false);
  });

  it('is a chain exactly at the threshold', () => {
    const places = chainOf(CHAIN_NAME_RECURRENCE);
    expect(isChain(places[0], buildNameRecurrenceIndex(places))).toBe(true);
  });

  it('remains a chain past the threshold', () => {
    const places = chainOf(CHAIN_NAME_RECURRENCE + 5);
    expect(isChain(places[0], buildNameRecurrenceIndex(places))).toBe(true);
  });

  it('treats a single establishment as independent', () => {
    const places = [outlet('p_1', 'Warung Mak Cik', 'Penang')];
    expect(isChain(places[0], buildNameRecurrenceIndex(places))).toBe(false);
  });
});

describe('isChain - state scoping', () => {
  // Nationally, a common name recurring says little. Within one state it is far
  // more likely to be one operator, which is why the test is state-scoped.
  it('does not treat the same name in different states as a chain', () => {
    const places = [
      outlet('p_1', 'Restoran Ali', 'Selangor'),
      outlet('p_2', 'Restoran Ali', 'Penang'),
      outlet('p_3', 'Restoran Ali', 'Johor')
    ];
    const index = buildNameRecurrenceIndex(places);
    expect(isChain(places[0], index)).toBe(false);
  });

  it('detects a chain only in the state where it recurs', () => {
    const places = [
      outlet('p_1', 'Restoran Ali', 'Selangor'),
      outlet('p_2', 'Restoran Ali', 'Selangor'),
      outlet('p_3', 'Restoran Ali', 'Selangor'),
      outlet('p_4', 'Restoran Ali', 'Penang')
    ];
    const index = buildNameRecurrenceIndex(places);
    expect(isChain(places[0], index)).toBe(true);   // Selangor
    expect(isChain(places[3], index)).toBe(false);  // Penang, single outlet
  });

  it('matches across cosmetic name differences', () => {
    const places = [
      outlet('p_1', 'Restoran Ali', 'Selangor'),
      outlet('p_2', 'RESTORAN ALI', 'Selangor'),
      outlet('p_3', '  Restoran  Ali ', 'selangor')
    ];
    expect(isChain(places[0], buildNameRecurrenceIndex(places))).toBe(true);
  });
});

describe('buildNameRecurrenceIndex - distinct records only', () => {
  // The same place appearing twice in one ingestion cycle is one outlet, not two.
  it('does not count a duplicated place record twice', () => {
    const places = [
      outlet('p_1', 'Restoran Ali', 'Selangor'),
      outlet('p_1', 'Restoran Ali', 'Selangor'),
      outlet('p_2', 'Restoran Ali', 'Selangor')
    ];
    expect(isChain(places[0], buildNameRecurrenceIndex(places))).toBe(false);
  });

  it('skips records missing a name or a state', () => {
    const places = [
      outlet('p_1', 'Restoran Ali', 'Selangor'),
      outlet('p_2', 'Restoran Ali', undefined),
      outlet('p_3', undefined, 'Selangor'),
      outlet('p_4', 'Restoran Ali', 'Selangor')
    ];
    expect(isChain(places[0], buildNameRecurrenceIndex(places))).toBe(false);
  });

  it('survives an empty catalogue', () => {
    expect(buildNameRecurrenceIndex([]).size).toBe(0);
  });
});

describe('localEconomySignal', () => {
  it('scores an independent establishment at full value', () => {
    const places = [outlet('p_1', 'Warung Mak Cik', 'Penang')];
    expect(localEconomySignal(places[0], buildNameRecurrenceIndex(places)))
      .toBe(LOCAL_VALUES.INDEPENDENT);
  });

  it('scores a chain at zero', () => {
    const places = Array.from({ length: CHAIN_NAME_RECURRENCE }, (_, i) =>
      outlet(`p_${i}`, 'Restoran Ali', 'Selangor'));
    expect(localEconomySignal(places[0], buildNameRecurrenceIndex(places)))
      .toBe(LOCAL_VALUES.CHAIN);
  });

  it('treats an unidentifiable place as independent rather than penalising it', () => {
    expect(localEconomySignal({}, buildNameRecurrenceIndex([])))
      .toBe(LOCAL_VALUES.INDEPENDENT);
    expect(localEconomySignal(undefined, undefined)).toBe(LOCAL_VALUES.INDEPENDENT);
  });
});

describe('localEconomySignalsFor - whole candidate set', () => {
  it('returns a signal per place, keyed by id', () => {
    const places = [
      outlet('p_1', 'Restoran Ali', 'Selangor'),
      outlet('p_2', 'Restoran Ali', 'Selangor'),
      outlet('p_3', 'Restoran Ali', 'Selangor'),
      outlet('p_solo', 'Warung Mak Cik', 'Selangor')
    ];
    const signals = localEconomySignalsFor(places);

    expect(signals.get('p_1')).toBe(LOCAL_VALUES.CHAIN);
    expect(signals.get('p_solo')).toBe(LOCAL_VALUES.INDEPENDENT);
    expect(signals.size).toBe(4);
  });

  it('returns an empty map for an empty set', () => {
    expect(localEconomySignalsFor([]).size).toBe(0);
  });
});
