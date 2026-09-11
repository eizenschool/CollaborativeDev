// ===== BUSINESS LOGIC LAYER (ChainDetection) =====
// FR-6.25 weight independent establishments above chains /
// FR-6.26 identify a chain by name recurrence across three or more distinct
// place records within the same state.
//
// Detection is by name recurrence rather than by a brand list because the
// catalogue is ingested without a maintainer: any hardcoded list of chains would
// go stale the moment a new franchise appears, and no use case in this module
// admits a person curating it.
//
// The state boundary matters. Nationally, "Restoran Ali" recurring five times
// says little - it is a common name. Within one state it is far more likely to be
// one operator with five outlets. Scoping the test to a state is what keeps a
// common name from being mistaken for a brand.

import { CHAIN_NAME_RECURRENCE, LOCAL_VALUES } from './constants.js';

/**
 * Names differ cosmetically across source records ("Restoran Ali", "RESTORAN
 * ALI", "Restoran  Ali  "). Comparison is on a normalised form so those collapse
 * to one, without mutating the stored name that users actually see.
 */
export function normaliseName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Counts, per (state, normalised name), how many distinct place records share it.
 * Built once per candidate set and reused for every place in it, rather than
 * recomputed per place.
 */
export function buildNameRecurrenceIndex(places = []) {
  const index = new Map();

  for (const place of places) {
    const name = normaliseName(place?.name);
    const state = normaliseName(place?.state);
    if (!name || !state) continue;

    const key = `${state}::${name}`;
    const seen = index.get(key) || new Set();
    // Distinct place records, not raw rows: the same place appearing twice in one
    // ingestion cycle must not count as two outlets.
    seen.add(place.placeId ?? place.id ?? name);
    index.set(key, seen);
  }

  return index;
}

export function isChain(place, index) {
  const name = normaliseName(place?.name);
  const state = normaliseName(place?.state);
  if (!name || !state || !index) return false;

  const seen = index.get(`${state}::${name}`);
  return Boolean(seen) && seen.size >= CHAIN_NAME_RECURRENCE;
}

/**
 * The local-economy signal fed into Desirability: 1.0 independent, 0.0 chain.
 *
 * This signal carries weight 0.10, which is deliberately below the 0.15 gap
 * between the two desirability thresholds. Independent operation can therefore
 * reorder candidates that are otherwise comparable, but cannot on its own carry
 * a poorly matched destination across a presentation boundary.
 */
export function localEconomySignal(place, index) {
  return isChain(place, index) ? LOCAL_VALUES.CHAIN : LOCAL_VALUES.INDEPENDENT;
}

/**
 * Convenience for a whole candidate set: builds the index once and returns each
 * place's signal, so callers do not have to remember the two-step usage.
 */
export function localEconomySignalsFor(places = []) {
  const index = buildNameRecurrenceIndex(places);
  return new Map(places.map((place) => [place.placeId ?? place.id, localEconomySignal(place, index)]));
}

export const ChainDetection = {
  recurrenceThreshold: CHAIN_NAME_RECURRENCE,
  normaliseName,
  buildNameRecurrenceIndex,
  isChain,
  localEconomySignal,
  localEconomySignalsFor
};
