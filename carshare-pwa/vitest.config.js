// Vitest reads this file in preference to vite.config.js, which is why Module 6's
// test setup lives here instead of being added to the shared build config: the app
// build and the test run stay completely independent of each other.
//
// No React plugin and a plain node environment, because everything under test is
// pure business-logic - PIN generation, haversine distance, confidence scoring. No
// component rendering means no jsdom and no JSX transform to configure.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests are fixture/offline by default even when a developer has a
    // live .env.local. Backend-specific tests opt in with vi.mock(), so a local
    // credential can never redirect ordinary unit tests to the shared project.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_GOOGLE_MAPS_EMBED_API_KEY: '',
      VITE_GOOGLE_MAPS_PLACES_API_KEY: '',
      VITE_WEB_PUSH_PUBLIC_KEY: '',
      VITE_DISCOVERY_DATA_SOURCE: 'fixture',
      VITE_M2_LIVE_TRACKING_ENABLED: 'false'
    },
    include: [
      'src/business-logic/verification/__tests__/**/*.test.js',
      'src/business-logic/discovery/__tests__/**/*.test.js',
      'src/business-logic/__tests__/**/*.test.js',
      // Module 6's Edge Functions are Deno, not Vite, so their logic sits
      // outside src/ and would otherwise be untestable - which is exactly how
      // FR-6.7 classification shipped two catalogue-wide bugs. Only each
      // function's pure logic module is reachable from here; every index.ts
      // imports `jsr:`/`npm:` specifiers Vitest cannot resolve, and is not
      // included by this glob.
      'supabase/functions/*/__tests__/**/*.test.js'
    ]
  }
});
