// ===== BUSINESS LOGIC LAYER (DemoClockService) =====
//
// UC6.5's 15-minute no-show window and UC6.22's 48-hour default confirmation can't
// be demonstrated by actually waiting, so this exposes a shared offset clock the
// GUI can fast-forward. Every time-dependent rule in Module 6 still takes `now` as
// an explicit argument (see TripConfirmationService / ExchangeSettlementService) -
// this only controls what value module6Db.now() hands them, so the rules
// themselves stay identical whether driven by this clock or a real one.
//
import { module6Db } from '../../data-access/module6Store.js';

export const DemoClockService = {
  backend: 'local',

  async advanceBy(ms) {
    return module6Db.advanceClock(ms);
  },

  async reset() {
    return module6Db.resetClock();
  },

  async getOffsetMs() {
    return module6Db.getClockOffset();
  }
};
