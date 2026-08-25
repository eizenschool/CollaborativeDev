import { defineConfig } from '@playwright/test';

const viewports = [
  { name: 'phone-375x812', width: 375, height: 812 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'tablet-landscape-1024x768', width: 1024, height: 768 },
  { name: 'desktop-1440x1024', width: 1440, height: 1024 },
];

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'en-MY',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: viewports.map(({ name, width, height }) => ({
    name,
    use: { viewport: { width, height } },
  })),
  webServer: {
    command: 'npm.cmd run dev:fixture -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/home',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
