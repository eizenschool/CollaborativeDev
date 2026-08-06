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
    // Scoped to Module 6's own folder. Other modules adding tests later pick their
    // own scope; nobody's suite can break or slow down anybody else's.
    include: ['src/business-logic/verification/__tests__/**/*.test.js']
  }
});
