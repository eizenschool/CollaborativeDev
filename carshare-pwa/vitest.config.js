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
    include: [
      'src/business-logic/verification/__tests__/**/*.test.js',
      'src/business-logic/discovery/__tests__/**/*.test.js',
      'src/business-logic/__tests__/**/*.test.js'
    ]
  }
});
