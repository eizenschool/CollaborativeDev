// Module 6-only test configuration. The team-wide vitest.config.js remains
// untouched so existing module test ownership and collection are unchanged.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/business-logic/m6-discovery/guide/__tests__/**/*.test.js',
      'tests/contracts/m6/TumpangGuideSql.test.js',
      'src/data-access/m6-discovery/__tests__/guideEdgeAdapter.test.js',
      'supabase/functions/m6-tumpang-guide/__tests__/**/*.test.js',
      'supabase/functions/m6-ingest/__tests__/travelAttributes.test.js'
    ]
  }
});
