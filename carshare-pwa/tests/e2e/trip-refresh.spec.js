import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.route('**/src/presentation/shared/context/AuthContext.jsx', (route) => route.fulfill({
    contentType: 'application/javascript', body: `import React from '/node_modules/.vite/deps/react.js';
    const { useEffect, useState } = React;
    export function useAuth() {
      const [user, setUser] = useState({ id: 'driver', fullName: 'Test Driver' });
      useEffect(() => {
        const refresh = () => setUser({ id: 'driver', fullName: 'Refreshed Driver' });
        window.addEventListener('test-profile-refresh', refresh);
        return () => window.removeEventListener('test-profile-refresh', refresh);
      }, []);
      return { user };
    }`,
  }));
  await page.route('**/src/presentation/m2-rides/components/ride/RideDetail.jsx', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace(/const LIVE_TRACKING_ENABLED = [^;]+;/, 'const LIVE_TRACKING_ENABLED = true;')
      .replace(/const SOS_ENABLED = [^;]+;/, 'const SOS_ENABLED = false;') });
  });
  await page.route('**/__trip-refresh*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('/src/main.jsx', '/tests/e2e/fixtures/trip-refresh.jsx') });
  });
});

test('same-account refresh and tab focus keep Trip Mode sharing mounted', async ({ page }) => {
  await page.goto('/__trip-refresh');
  await expect(page.getByRole('heading', { name: 'Your sharing is off' })).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Start sharing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your sharing is on' })).toBeVisible();
  const reads = await page.evaluate(() => {
    const count = window.tripRefresh.reads;
    window.dispatchEvent(new Event('test-profile-refresh'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    return count;
  });
  await expect.poll(() => page.evaluate(() => window.tripRefresh.reads)).toBeGreaterThan(reads);
  await expect.poll(() => page.evaluate(() => window.tripRefresh.completedReads)).toBeGreaterThan(reads);
  await expect(page.getByRole('heading', { name: 'Your sharing is on' })).toBeVisible();
  expect(await page.evaluate(() => window.tripRefresh.stops)).toBe(0);
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your sharing is off' })).toBeVisible();
  expect(await page.evaluate(() => window.tripRefresh.stops)).toBe(1);
});

test('Ride workspace does not restart loading for the same account profile', async ({ page }) => {
  await page.goto('/__trip-refresh?hub');
  await expect(page.getByRole('heading', { name: 'My rides', exact: true })).toBeVisible();
  const reads = await page.evaluate(() => window.tripRefresh.reads);
  await page.evaluate(() => window.dispatchEvent(new Event('test-profile-refresh')));
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.tripRefresh.reads)).toBe(reads);
  await expect(page.getByRole('heading', { name: 'My rides', exact: true })).toBeVisible();
});
