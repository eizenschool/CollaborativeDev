// Module 6 FR-6.3 Stale at three absent cycles / FR-6.4 Retired at ten and
// withheld / FR-6.5 restore on reappearance preserving interest, run by the
// scheduled sweep (042_m6_scheduled_ingestion.sql's weekly cron). Mirrors the
// thresholds and the state machine already proven in
// src/business-logic/discovery/PlaceLifecycle.js and pinned by
// PlaceLifecycle.test.js, reimplemented locally rather than imported across
// the src/ boundary - see regions.ts's own note on why this directory
// imports nothing outside itself.
//
// One rule carries over unchanged, and lives here rather than in this file:
// absence is only ever counted against a place a completed cycle actually
// looked for. This module only computes the state transition for a place
// already known to be absent; regions.ts's isWithinSweptRegions is what the
// caller uses to decide which places qualify in the first place.

export const STALE_AFTER_CYCLES = 3;
export const RETIRED_AFTER_CYCLES = 10;

export type LifecycleState = "Pending Enrichment" | "Active" | "Provisional" | "Stale" | "Retired";

export type DecayInput = {
  absenceCounter: number;
  lifecycleState: LifecycleState;
  stateBeforeDemotion: LifecycleState | null;
};

export type DecayResult = {
  absenceCounter: number;
  lifecycleState: LifecycleState;
  stateBeforeDemotion: LifecycleState | null;
};

function stateForAbsence(currentState: LifecycleState, cycles: number): LifecycleState {
  if (cycles < STALE_AFTER_CYCLES) return currentState;
  if (cycles >= RETIRED_AFTER_CYCLES) return "Retired";
  return "Stale";
}

/**
 * One completed sweep cycle applied to a catalogue place it did not find.
 *
 * Captures the state held before demotion so a later reappearance can restore
 * it (FR-6.5) rather than defaulting to Provisional - the same distinction
 * PlaceLifecycle.js's applyAbsentCycle makes, and for the same reason: once a
 * place is already Stale, the state worth restoring is the Active/Provisional
 * one it held before, not Stale itself, so a place already demoted does not
 * overwrite its own capture on a second absent cycle.
 */
export function applyAbsentCycle(place: DecayInput): DecayResult {
  const absenceCounter = (Number(place.absenceCounter) || 0) + 1;
  const nextState = stateForAbsence(place.lifecycleState, absenceCounter);

  const wasRecommendable = place.lifecycleState === "Active" || place.lifecycleState === "Provisional";
  const stateBeforeDemotion = wasRecommendable && nextState !== place.lifecycleState
    ? place.lifecycleState
    : place.stateBeforeDemotion ?? null;

  return { absenceCounter, lifecycleState: nextState, stateBeforeDemotion };
}
