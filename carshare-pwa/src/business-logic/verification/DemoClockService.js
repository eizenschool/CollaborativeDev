// ===== BUSINESS LOGIC LAYER (DemoClockService) =====
//
// UC6.5's 15-minute no-show window and UC6.22's 48-hour default confirmation can't
// be demonstrated by actually waiting, so this exposes a shared offset clock the
// GUI can fast-forward. Every time-dependent rule in Module 6 still takes `now` as
// an explicit argument (see TripConfirmationService / ExchangeSettlementService) -
// this only controls what value module6Db.now() hands them, so the rules
// themselves stay identical whether driven by this clock or a real one.
//
// Same guard shape as HostImpactEngine.applyDemoAdjustment: demo-only controls
// refuse to run once a real backend is configured, so they can never be mistaken
// for production behaviour.

import { isSupabaseConfigured } from '../../data-access/supabaseClient.js';
import { module6Db } from '../../data-access/module6Store.js';

function assertMockBackend() {
  if (isSupabaseConfigured) {
    throw new Error('Demo clock controls are only available against the mock backend.');
  }
}

export const DemoClockService = {
  async advanceBy(ms) {
    assertMockBackend();
    return module6Db.advanceClock(ms);
  },

  async reset() {
    assertMockBackend();
    return module6Db.resetClock();
  },

  async getOffsetMs() {
    return module6Db.getClockOffset();
  }
};
